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

	function walkSiblings(parent, beforeAfterChild, before, at, after, arg) {
		var fn = before;
		Dom.walk(parent.firstChild, function (child) {
			if (child !== beforeAfterChild) {
				return fn(child, arg);
			} else {
				fn = after;
				return at(child, arg);
			}
		});
	}

	function ascendWalkSiblings(ascendNodes, atEnd, carryDown, before, at, after, arg) {
		var i;
		var args = [];
		var arg = null;
		for (i = ascendNodes.length; i--; ) {
			arg = carryDown(ascendNodes[i]) || arg;
			args.push(arg);
		}
		args.reverse();
		// Because with end positions like
		// <elem>text{</elem> or <elem>text}</elem>
		// ascendecending would start at <elem> ignoring "text".
		if (ascendNodes.length && atEnd) {
			Dom.walk(ascendNodes[0].firstChild, function (node) {
				return before(node, args[0]);
			});
		}
		for (i = 0; i < ascendNodes.length - 1; i++) {
			var child = ascendNodes[i];
			var parent = ascendNodes[i + 1];
			walkSiblings(parent, child, before, at, after, args[i + 1]);
		}
	}

	function ascendBoundaryPointWalkSiblings(node, atEnd, cac, carryDown, before, at, after, arg) {
		var uptoInclCacChild = Dom.childAndParentsUntil(node, function (node) {
			return node === cac;
		});
		var arg = carryDown(cac) || arg;
		ascendWalkSiblings(uptoInclCacChild, atEnd, carryDown, before, at, after, arg);
		return uptoInclCacChild.length ? uptoInclCacChild[uptoInclCacChild.length - 1] : null;
	}

	/**
	 * Requires range's boundary points to be between nodes
	 * (Dom.splitTextContainers).
	 */
	function walkBoundary(range, carryDown, stepOutside, stepPartial, stepInside, arg) {
		// Because range may be mutated during traversal.
		var cac = range.commonAncestorContainer;
		var sc  = range.startContainer;
		var ec  = range.endContainer;
		var so  = range.startOffset;
		var eo  = range.endOffset;
		var start    = Dom.nodeAtOffset(sc, so);
		var end      = Dom.nodeAtOffset(ec, eo);
		var startAtE = Dom.isAtEnd(sc, so);
		var endAtE   = Dom.isAtEnd(ec, eo);
		var cacChildStart = ascendBoundaryPointWalkSiblings(start, startAtE, cac, carryDown, stepOutside, stepPartial, stepInside, arg);
		var cacChildEnd   = ascendBoundaryPointWalkSiblings(end, endAtE, cac, carryDown, stepInside, stepPartial, stepOutside, arg);
		function isCacChildStart(node) { return node === cacChildStart; }
		function isCacChildEnd  (node) { return node === cacChildEnd  ; }
		if (cacChildStart && cacChildStart !== cacChildEnd) {
			var next;
			Dom.walkUntil(cac.firstChild, stepOutside, isCacChildStart);
			next = start === cacChildStart
			     ? stepInside(cacChildStart)
				 : stepPartial(cacChildStart);
			// Because cacChildEnd === null will correctly walk to the
			// last child of cac, we can just use isCacChildEnd.
			Dom.walkUntil(next, stepInside, isCacChildEnd);
			if (cacChildEnd) {
				next = end === cacChildEnd
					 ? stepInside(cacChildEnd)
					 : stepPartial(cacChildEnd);
				Dom.walk(next, stepOutside);
			}
		}
	}

	/**
	 * Requires range's boundary points to be between nodes
	 * (Dom.splitTextContainers).
	 */
	function pushDownContext(range, pushDownFrom, cacOverride, getOverride, clearOverride, clearOverrideRec, pushDownOverride) {
		// Because range may be mutated during traversal.
		var cac = range.commonAncestorContainer;
		walkBoundary(range, getOverride, pushDownOverride, clearOverride, clearOverrideRec, cacOverride);
		var fromCacToTop = Dom.childAndParentsUntilIncl(cac, function (node) {
			return node === pushDownFrom;
		});
		ascendWalkSiblings(fromCacToTop, false, getOverride, pushDownOverride, clearOverride, pushDownOverride, null);
		clearOverride(pushDownFrom);
	}

	function walkTopLevelContainedNodes(range, stepInside) {
		walkBoundary(range, Fn.noop, Fn.noop, Fn.noop, stepInside, null);
	}

	/**
	 * Walks around the boundaries of range and calls the given
	 * functions with the nodes it encounters.
	 *
	 * The purpose of the walk is to either push-down or set a context
	 * on all nodes within the range, and push-down any overrides that
	 * exist along the bounderies of the range.
	 *
	 * An override is a context that overrides the context to set.
	 *
	 * Pushing-down a context means that an existing context-giving
	 * ancestor element will be reused, if available, and setContext
	 * will not be invoked.
	 *
	 * Pushing-down an override means that ancestors of the range's
	 * start or end containers will have their overrides cleared and the
	 * subset of the ancestors' children that is not contained by the
	 * range will have the override applied via pushDownOverride().
	 *
	 * This algorithm will not by itself mutate anything, or depend on
	 * any mutations by the given functions, except it will split the
	 * text nodes around the boundaries and adjust the range properties
	 * once before starting the walk.
	 *
	 * clearOverride, clearOverideRec, setContext, pushDownContext may
	 * mutate the given node and it's previous siblings, and may insert
	 * nextSiblings, and must return the nextSibling of the given node
	 * (the nextSibling before any mutations).
	 *
	 * Doesn't handle the case where for example a bold element is at
	 * the same time the upper boundary (for example when the bold
	 * element itself is the editing host) and the client attempts to
	 * set a non-bold context inside the bold element. To work around
	 * this, setContext() could force a non-bold context by wrapping the
	 * node with a <span style="font-weight: normal">.
	 *
	 * @param range
	 * clearOverride    - invoked for partially contained nodes.
	 * clearOverrideRec - invoked for top-level contained nodes.
	 * setContext       - invoked for top-level contained nodes.
	 * pushDownOverride - invoked for left siblings of ancestors
	 *   of startContainer[startOffset], and for right siblings of
	 *   ancestors of endContainer[endOffset].
	 *
	 * @param isUpperBoundary args (node). Identifies exclusive upper
	 * boundary element, only elements below which will be modified.
	 *
	 * @param getOverride(node). Returns a node's override, or
	 * null if the node does not provide an override. The topmost node
	 * for which getOverride returns a non-null value is the topmost
	 * override. If there is a topmost override, and it is below the
	 * upper boundary element, it will be cleared and pushed down.
	 *
	 * @param clearOverride(node). Should clear the given node of an
	 * override. The given node may or may not have an override
	 * set. Will be called shallowly for all ancestors of start and end
	 * containers (up to isUpperBoundary or isContext). May perform
	 * mutations as explained above.
	 *
	 * @parma clearOverrideRec(node). Like clearOverride but
	 * should clear the override recursively.
	 *
	 * @param pushDownOverride(node, override). Applies the given
	 * override to node. Should check whether the given node doesn't
	 * already provide its own override, in which case the given
	 * override should not be applied. May perform mutations as
	 * explained above.
	 *
	 * @param isContext(node). Returns true if the given node
	 * already provides the context to set.
	 *
	 * @param setContext(node, hasOverrideAncestor). Applies the context
	 * to the given node. Should clear overrides recursively. Should
	 * also clear context recursively to avoid unnecessarily nested
	 * contexts. May perform mutations as explained above.
	 */
	function mutate(range, isUpperBoundary, getOverride, clearOverride, clearOverrideRec, pushDownOverride, isContext, setContext, rootHasContext) {
		// Because we should avoid splitTextContainers() if this call is a noop.
		if (range.collapsed) {
			return;
		}
		// Because pushDown() and walkBoundary() require boundary points
		// to be between nodes.
		Dom.splitTextContainers(range);
		// Because range may be mutated during traversal.
		var cac = range.commonAncestorContainer;
		var topmostOverrideNode = null;
		var bottommostOverrideNode = null;
		var isNonClearableOverride = false;
		var upperBoundaryAndBeyond = false;
		var fromCacToContext = Dom.childAndParentsUntilIncl(cac, isContext);
		Arrays.forEach(fromCacToContext, function (node) {
			upperBoundaryAndBeyond = upperBoundaryAndBeyond || isUpperBoundary(node);
			if (getOverride(node)) {
				topmostOverrideNode = node;
				isNonClearableOverride = upperBoundaryAndBeyond;
				bottommostOverrideNode = bottommostOverrideNode || node;
			}
		});
		if ((rootHasContext || isContext(fromCacToContext[fromCacToContext.length - 1]))
			    && !isNonClearableOverride) {
			var pushDownFrom = topmostOverrideNode || cac;
			var cacOverride = getOverride(bottommostOverrideNode || cac);
			pushDownContext(range, pushDownFrom, cacOverride, getOverride, clearOverride, clearOverrideRec, pushDownOverride);
		} else {
			walkTopLevelContainedNodes(range, function (node) {
				return setContext(node, isNonClearableOverride);
			});
		}
	}

	function format(range, nodeName, unformat) {
		function getOverride(node) {
			if (!unformat) {
				return null;
			}
			return nodeName === node.nodeName;
		}
		function clearOverride(node) {
			var next = node.nextSibling;
			if (unformat && nodeName === node.nodeName) {
				Dom.shallowRemove(node, range);
			}
			return next;
		}
		function clearOverrideRec(node) {
			return Dom.walkRec(node, clearOverride);
		}
		function clearContext(node) {
			var next = node.nextSibling;
			if (!unformat && nodeName === node.nodeName) {
				Dom.shallowRemove(node, range);
			}
			return next;
		}
		function clearContextRec(node) {
			return Dom.walkRec(node, clearContext);
		}
		function pushDownOverride(node, override) {
			if (!unformat) {
				throw "not implemented";
			}
			var wrapper = document.createElement(nodeName);
			Dom.wrap(node, wrapper, range);
			return wrapper.nextSibling;
		}
		function isContext(node) {
			if (unformat) {
				// Because we pass rootHasContext in the call to mutate,
				// we don't really need this, but it is not incorrect.
				return node.nodeName === 'BODY';
			}
			return nodeName === node.nodeName;
		}
		function setContext(node) {
			if (unformat) {
				throw "not implemented";
			}
			var wrapper = document.createElement(nodeName);
			Dom.wrap(node, wrapper, range);
			Dom.walk(wrapper.firstChild, clearOverrideRec);
			Dom.walk(wrapper.firstChild, clearContextRec);
			return wrapper.nextSibling;
		}
		function isUpperBoundary(node) {
			return !node.parentNode;
		}
		mutate(range, isUpperBoundary, getOverride, clearOverride, clearOverrideRec, pushDownOverride, isContext, setContext, unformat);
	}

	return {
		mutate: mutate,
		format: format
	};
});
