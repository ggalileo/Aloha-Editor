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

	function walkChildren(parent, beforeAtAfterChild, before, at, after, arg) {
		var fn = before;
		var children = Array.prototype.slice.call(parent.childNodes);
		for (var i = 0; i < children.length; i++) {
			var child = children[i];
			if (child !== beforeAtAfterChild) {
				fn(child, arg);
			} else {
				at(child, arg);
				fn = after;
			}
		}
	}

	function descendWalkChildren(descendInto, atEnd, descend, before, at, after, arg) {
		var node = null;
		while (descendInto.length) {
			node = descendInto.pop();
			arg = descend(node, arg);
			if (!descendInto.length) {
				break;
			}
			var nextNode = descendInto[descendInto.length - 1];
			walkChildren(node, nextNode, before, at, after, arg);
		}
		// Because with end positions like
		// <elem>xx{</elem> or <elem>xx}</elem>
		// descendecending would stop at <elem> and not reach "xx".
		if (node && atEnd) {
			var children = Array.prototype.slice.call(node.childNodes);
			for (var i = 0; i < children.length; i++) {
				before(children[i], arg);
			}
		}
	}

	function descendBoundaryWalkChildren(boundaryNode, boundaryOffset, cac, descend, before, at, after, arg) {
		function belowEqCac(node) {
			return node.parentNode === cac
				|| node === cac
		}
		var lowest = Dom.nodeAtOffset(boundaryNode, boundaryOffset);
		var atEnd = Dom.isAtEnd(boundaryNode, boundaryOffset);
		var descendInto = Dom.childAndParentsUntilIncl(lowest, belowEqCac);
		descendWalkChildren(descendInto, atEnd, descend, before, at, after, arg);
		return descendInto[0];
	}

	/**
	 * Requires range's boundary points to be between nodes
	 * (Dom.splitTextContainers).
	 */
	function walkBoundary(range, descend, stepOutside, stepInside) {
		var s = range.startContainer;
		var e = range.endContainer;
		var so = range.startOffset;
		var eo = range.endOffset;
		var cac = range.commonAncestorContainer;
		var cacChildStart = descendBoundaryWalkChildren(s, so, cac, descend, stepOutside, stepInside, stepInside);
		var cacChildEnd   = descendBoundaryWalkChildren(e, eo, cac, descend, stepInside , stepInside, stepOutside);
		if (cacChildStart !== cacChildEnd && cacChildStart.parentNode === cacChildEnd.parentNode) {
			var node = cacChildStart.nextSibling;
			while (node && node !== cacChildEnd) {
				stepInside(node);
				node = node.nextSibling;
			}
		}
	}

	/**
	 * Requires range's boundary points to be between nodes
	 * (Dom.splitTextContainers).
	 */
	function pushDownContext(range, topmostOverride, getOverride, clearOverride, pushDownOverride) {
		function clearOverrideRec(node) {
			Dom.traverse(node, function (node) {
				clearOverride(node);
				return node;
			});
		}
		function descend(node, override) {
			var maybeOverride = getOverride(node);
			if (maybeOverride) {
				override = maybeOverride;
				clearOverride(node);
			}
			return override;
		}
		function isTopmostOverride(node) {
			return node === topmostOverride;
		}
		var descendInto = Dom.childAndParentsUntilIncl(range.commonAncestorContainer, isTopmostOverride);
		var override = descendWalkChildren(descendInto, false, descend, pushDownOverride, Fn.noop, pushDownOverride, null);
		walkBoundary(range, descend, pushDownOverride, clearOverrideRec);
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
	 * exist along the bounderies of the range. An override is a context
	 * that conflicts with the context to set. Pushing-down a context
	 * means that an existing context-giving ancestor element will be
	 * reused (if available) and setContext will not be
	 * invoked. Pushing-down an override means that ancestors of the
	 * range's start or end containers will have their overrides cleared
	 * and the subset of the ancestors' children that is not contained
	 * by the range will have the override applied via
	 * pushDownOverride().
	 *
	 * Doesn't handle the case where an ancestor of the node for which
	 * isUpperBoundary() returns true, or the upper boundary node
	 * itself, override the context. This could be when a bold element
	 * is at the same time the upper boundary (for example when the bold
	 * element itself is the editing host) and the client attempts to
	 * set a non-bold context inside the bold element. To work around
	 * this, setContext() could force a non-bold context by wrapping the
	 * range with a <span style="font-weight: normal">.
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
	 * an override. The given node may or may not provide an
	 * override. Will be called recursively for all contained nodes in
	 * range and for all ancestors of start and end containers (up to
	 * isUpperBoundary or isContext).
	 *
	 * @param pushDownOverride args (node, override). Applies the given
	 * override to node. Should check whether the given node doesn't
	 * already provide its own override, in which case the given
	 * override should not be applied.
	 *
	 * @param isContext args (node). Returns true if the given node
	 * already provides the context to set.
	 *
	 * @param setContext args (node). Applies the context to the given
	 * node. Should clear context recursively to avoid unnecessarily
	 * nested contexts.
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
		Arrays.forEach(Dom.childAndParentsUntilIncl(range.commonAncestorContainer, Fn.returnFalse), function (node) {
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
			walkBoundary(range, Fn.noop, Fn.noop, setContext);
		}
	}

	function format(range, nodeName, unformat) {
		function getOverride(node) {
			return unformat && nodeName === node.nodeName;
		}
		function clearOverride(node) {
			if (unformat && node.nodeName === node.nodeName) {
				Dom.shallowRemove(node);
			}
		}
		function pushDownOverride(node, override) {
			if (!unformat) {
				throw null;
			}
			Dom.wrap(node, document.createElement(nodeName));
		}
		function isContext(node) {
			return (nodeName === node.nodeName) ^ unformat;
		}
		function setContext(node) {
			if (unformat) {
				throw null;
			}
			Dom.traverse(node, function (node) {
				clearOverride(node);
				return node;
			});
			Dom.wrap(node, document.createElement(nodeName));
		}
		mutate(range, function (node) { return !node.parentNode; }, getOverride, clearOverride, pushDownOverride, isContext, setContext);
	}

	return {
		mutate: mutate,
		format: format
	};
});
