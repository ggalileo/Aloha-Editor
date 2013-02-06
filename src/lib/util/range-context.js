/* range-context.js is part of Aloha Editor project http://aloha-editor.org
 *
 * Aloha Editor is a WYSIWYG HTML5 inline editing library and editor. 
 * Copyright (c) 2010-2012 Gentics Software GmbH, Vienna, Austria.
 * Contributors http://aloha-editor.org/contribution.php 
 * 
 * Aloha Editor is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or any later version.
 *
 * Aloha Editor is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 * 
 * As an additional permission to the GNU GPL version 2, you may distribute
 * non-source (e.g., minimized or compacted) forms of the Aloha-Editor
 * source code without the copy of the GNU GPL normally required,
 * provided you include this license notice and a URL through which
 * recipients can access the Corresponding Source.
 */
define([
	'util/dom2',
	'util/arrays',
	'util/trees',
	'util/functions'
], function (
	Dom,
	Arrays,
	Trees,
	Fn
) {
	'use strict';

	function walkSiblings(parent, beforeAfterChild, before, after, arg) {
		var fn = before;
		Dom.replaceAtAfter(parent.firstChild, function (child) {
			if (child !== beforeAfterChild) {
				child = fn(child, arg);
			} else {
				fn = after;
			}
		});
	}

	function ascendWalkSiblings(ascendNodes, atEnd, carryDown, ascend, before, after, arg) {
		var i;
		var args = [];
		var arg = null;
		for (i = ascendNodes.length; i--; ) {
			arg = carryDown(ascendNodes[i], arg) || arg;
			args.push(arg);
		}
		// Because with end positions like
		// <elem>xx{</elem> or <elem>xx}</elem>
		// ascendecending would start at <elem> and not "xx".
		if (ascendNodes.length && atEnd) {
			Dom.replaceAtAfter(ascendNodes[0].firstChild, before);
		}
		var node;
		for (i = 0; i < ascendNodes.length; i++) {
			node = ascendNodes[i];
			var parent = node.parentNode;
			if (parent) {
				walkSiblings(parent, node, before, after, args[i]);
			}
			node = Dom.replace(node, ascend(node));
		}
		return node;
	}

	function ascendBoundaryPointWalkSiblings(boundaryNode, boundaryOffset, isCac, carryDown, ascend, before, after, arg) {
		var lowest = Dom.nodeAtOffset(boundaryNode, boundaryOffset);
		var atEnd = Dom.isAtEnd(boundaryNode, boundaryOffset);
		var ascendNodes = Dom.childAndParentsUntilIncl(lowest, isCac);
		return ascendWalkSiblings(ascendNodes, atEnd, carryDown, ascend, before, after, arg);
	}

	/**
	 * Requires range's boundary points to be between nodes
	 * (Dom.splitTextContainers).
	 */
	function walkBoundary(range, carryDown, ascend, stepOutside, stepInside) {
		var cac = range.commonAncestorContainer;
		function isCac(node) {
			return node === cac;
		}
		var s  = range.startContainer;
		var e  = range.endContainer;
		var so = range.startOffset;
		var eo = range.endOffset;
		cac = ascendBoundaryPointWalkSiblings(s, so, isCac, carryDown, ascend, stepOutside, stepInside);
		if (!cac) {
			return null;
		}
		cac = ascendBoundaryPointWalkSiblings(e, eo, isCac, carryDown, ascend, stepInside , stepOutside);
		if (!cac) {
			return null;
		}
		var cacChildStart = Dom.childAndParentsUntil(s, isCac).pop();
		var cacChildEnd   = Dom.childAndParentsUntil(e, isCac).pop();
		function isCacChildEnd(node) {
			return node === cacChildEnd;
		}
		if (cacChildStart !== cacChildEnd && cacChildStart.parentNode === cacChildEnd.parentNode) {
			Dom.replaceAtAfterUntil(cacChildStart.nextSibling, stepInside, isCacChildEnd);
		}
		return cac;
	}

	/**
	 * Requires range's boundary points to be between nodes
	 * (Dom.splitTextContainers).
	 */
	function pushDownContext(range, topmostOverride, getOverride, clearOverride, pushDownOverride) {
		function clearOverrideRec(node) {
			return Dom.replaceRec(node, clearOverride);
		}
		function isTopmostOverride(node) {
			return node === topmostOverride;
		}
		// Because we need an override to start with, which may be
		// topmostOverride, but may be lower but above or at cac.
		var startOverrideNode = Dom.childAndParentsUntilIncl(range.commonAncestorContainer, getOverride)[0];
		var startOverride = getOverride(startOverrideNode);
		function carryDown(node, override) {
			return getOverride(node) || override || startOverride;
		}
		var carryDown   = getOverride;
		var ascend      = clearOverride;
		var stepOutside = pushDownOverride;
		var stepInside  = clearOverrideRec;
		// Because the common ancestor container may be removed by clearOverride.
		var cacParent = range.commonAncestorContainer.parentNode;
		var cac = walkBoundary(range, carryDown, ascend, stepOutside, stepInside);
		var ascendNodes = Dom.childAndParentsUntilIncl(cac || cacParent, isTopmostOverride);
		ascendWalkSiblings(ascendNodes, false, carryDown, ascend, stepOutside, stepOutside);
	}

	/**
	 * Walks around the boundaries of range and calls the given
	 * functions with the nodes it encounters. This algorithm will not
	 * by itself mutate anything, or depend on any mutations by the
	 * given functions, except it will split the text nodes around the
	 * boundaries and adjust the range properties once before starting
	 * the walk.
	 *
	 * The purpose of the walk is to either push-down or set a context
	 * on all nodes within the range, and push-down any overrides that
	 * exist along the bounderies of the range.
	 *
	 * An override is a context that conflicts with the context to
	 * set.
	 *
	 * Pushing-down a context means that an existing context-giving
	 * ancestor element will be reused (if available) and setContext
	 * will not be invoked.
	 *
	 * Pushing-down an override means that ancestors of the range's
	 * start or end containers will have their overrides cleared and the
	 * subset of the ancestors' children that is not contained by the
	 * range will have the override applied via pushDownOverride().
	 *
	 * Doesn't handle the case where an ancestor of the node for which
	 * isUpperBoundary() returns true, or the upper boundary node
	 * itself, override the context. This could be when a bold element
	 * is at the same time the upper boundary (for example when the bold
	 * element itself is the editing host) and the client attempts to
	 * set a non-bold context inside the bold element. To work around
	 * this, setContext() could force a non-bold context by wrapping the
	 * node with a <span style="font-weight: normal">.
	 *
	 * @param range
	 * clearOverride - will be invoked recursively for contained nodes
	 *   and shallowly for partially contained nodes.
	 * setContext - will be invoked shallowly for top-level contained
	 *   nodes.
	 * pushDownOverride - will be invoked for left siblings of ancestors
	 *   of startContainer, and for right siblings of ancestors of
	 *   endContainer.
	 *
	 * @param isUpperBoundary args (node). Identifies exclusive upper
	 * boundary element, only elements below which will be modified.
	 *
	 * @param getOverride args (node). Returns a node's override, or
	 * null if the node does not provide an override. The topmost node
	 * for which getOverride returns a non-null value is the topmost
	 * override. If there is a topmost override, and it is below the
	 * upper boundary element, it will be cleared and pushed down.
	 *
	 * @param clearOverride args (node). Should clear the given node of
	 * an override. The given node may or may not have an override
	 * set. Will be called recursively for all contained nodes in range
	 * and shallowly for all ancestors of start and end containers (up
	 * to isUpperBoundary or isContext). May mutate the given node's
	 * children or siblings.
	 *
	 * @param pushDownOverride args (node, override). Applies the given
	 * override to node. Should check whether the given node doesn't
	 * already provide its own override, in which case the given
	 * override should not be applied. May mutate the given node's
	 * children or siblings.
	 *
	 * @param isContext args (node). Returns true if the given node
	 * already provides the context to set.
	 *
	 * @param setContext args (node). Applies the context to the given
	 * node. Should clear context recursively to avoid unnecessarily
	 * nested contexts. May mutate the given node's children or
	 * siblings.
	 */
	function mutate(range, isUpperBoundary, getOverride, clearOverride, pushDownOverride, isContext, setContext) {
		// Because we should avoid splitTextContainers() if this call is a noop.
		if (range.collapsed) {
			return;
		}
		// Because pushDown() and walkBoundary() require boundary points
		// to be between nodes.
		Dom.splitTextContainers(range);
		var topmostOverrideNode = null;
		var topmostContextNode = null;
		var isNonClearableOverride = false;
		var beyondUpperBoundary = false;
		var allCacAncestors = Dom.childAndParentsUntilIncl(range.commonAncestorContainer, Fn.returnFalse);
		Arrays.forEach(allCacAncestors, function (node) {
			beyondUpperBoundary = beyondUpperBoundary || isUpperBoundary(node);
			if (getOverride(node)) {
				topmostOverrideNode = node;
				isNonClearableOverride = beyondUpperBoundary;
			}
			if (isContext(node)) {
				topmostContextNode = node;
			}
		});
		if (topmostOverrideNode && !isNonClearableOverride) {
			pushDownContext(range, topmostOverrideNode, getOverride, clearOverride, pushDownOverride);
		} else if (!topmostContextNode || isNonClearableOverride) {
			walkBoundary(range, Fn.noop, Fn.noop, Fn.noop, setContext);
		}
	}

	function format(range, nodeName, unformat) {
		function getOverride(node) {
			return unformat && nodeName === node.nodeName;
		}
		function clearOverride(node) {
			if (unformat && node.nodeName === node.nodeName) {
				Dom.shallowRemove(node);
				return null;
			}
			return node;
		}
		function pushDownOverride(node, override) {
			if (!unformat) {
				throw null;
			}
			Dom.wrap(node, document.createElement(nodeName));
			return null;
		}
		function isContext(node) {
			return (nodeName === node.nodeName) ^ unformat;
		}
		function setContext(node) {
			if (unformat) {
				throw null;
			}
			node = Dom.replaceRec(node, function (node) {
				return clearOverride(node);
			});
			var wrapper = document.createElement(nodeName);
			Dom.wrap(node, wrapper);
			return wrapper;
		}
		mutate(range, function (node) { return !node.parentNode; }, getOverride, clearOverride, pushDownOverride, isContext, setContext);
	}

	return {
		mutate: mutate,
		format: format
	};
});
