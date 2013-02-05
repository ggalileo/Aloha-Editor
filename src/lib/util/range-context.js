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
define(['util/dom2', 'util/trees', 'util/functions'], function (Dom, Trees, Fn) {
	'use strict';

	function walkChildrenBeforeAtAfter(parent, beforeAtAfterChild, before, at, after, arg) {
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

	function descendWalkChildrenBeforeAtAfter(node, offset, isUppermostAncestor, descend, before, at, after, arg) {
		var child = Dom.nodeAtOffset(node, offset);
		var descendInto = Dom.childAndParentsUntilIncl(child, isUppermostAncestor);
		while (descendInto.length) {
			var desc = descendInto.pop();
			arg = descend(desc, arg);
			if (!descendInto.length) {
				break;
			}
			var nextDesc = descendInto[descendInto.length - 1];
			walkChildrenBeforeAtAfter(desc, nextDesc, before, at, after, arg);
		}
		// Because nodeAtOffset() doesn't handle atEnd positions like
		// <elem>xx{</elem> or <elem>xx}</elem>
		// decending would stop at <elem> and not reach "xx"
		if (Dom.isAtEnd(node, offset)) {
			var children = Array.prototype.slice.call(node.childNodes);
			for (var i = 0; i < children.length; i++) {
				before(children[i], arg);
			}
		}
	}

	function pushDown(node, offset, override, isUppermostAncestor, getOverride, clearOverride, pushDownBefore, pushDownAfter) {
		var descend = function (node, override) {
			var maybeOverride = getOverride(node);
			if (maybeOverride) {
				override = maybeOverride;
				// Because the uppermost ancestor already has the
				// context that we are pushing down.
				if (!isUppermostAncestor(node)) {
					clearOverride(node);
				}
			}
			return override;
		};
		descendWalkChildrenBeforeAtAfter(node, offset, isUppermostAncestor, descend, pushDownBefore, pushDownAfter, pushDownAfter, override);
	}

	/**
	 * Requires range's start and end offsets to be 0 if they point
	 * inside text nodes.
	 */
	function pushDownContext(range, isUpperBoundary, getOverride, clearOverride, pushDownOverride, isContext) {
		if (range.collapsed) {
			return false;
		}
		function stopAt(node) {
			return isContext(node) || isUpperBoundary(node);
		}
		if (isUpperBoundary(Dom.childAndParentsUntilIncl(range.commonAncestorContainer, stopAt).pop())) {
			// Because we found no context to push down.
			return false;
		}
		function clearOverrideRec(node) {
			Dom.traverse(node, clearOverride);
		}
		function belowEqCac(node) {
			return node.parentNode === range.commonAncestorContainer
			    // Because the range containers may be the cac itself.
				|| node === range.commonAncestorContainer;
		}
		var cac = range.commonAncestorContainer;
		var override = pushDown(cac.parentNode      , Dom.nodeIndex(cac), null    , isContext, getOverride, clearOverride, pushDownOverride, clearOverrideRec);
		var unused   = pushDown(range.startContainer, range.startOffset , override, belowEqCac, getOverride, clearOverride, pushDownOverride, clearOverrideRec);
		var unused2  = pushDown(range.endContainer  , range.endOffset   , override, belowEqCac, getOverride, clearOverride, clearOverrideRec, pushDownOverride);
		var cacChildStart = Dom.childAndParentsUntilIncl(Dom.nodeAtOffset(range.startContainer, range.startOffset), belowEqCac).pop();
		var cacChildEnd   = Dom.childAndParentsUntilIncl(Dom.nodeAtOffset(range.endContainer, range.endOffset), belowEqCac).pop();
		if (cacChildStart.parentNode === range.commonAncestorContainer) {
			var node = cacChildStart;
			while (node && node !== cacChildEnd) {
				clearOverrideRec(node);
				node = node.nextSibling;
			}
		}
		return true;
	}

	function walkTopmostContainedNodes(range, step) {
		function belowEqCac(node) {
			return node.parentNode === range.commonAncestorContainer
				|| node === range.commonAncestorContainer;
		}
		var cacChildStart = Dom.childAndParentsUntilIncl(Dom.nodeAtOffset(range.startContainer, range.startOffset), belowEqCac).pop();
		var cacChildEnd   = Dom.childAndParentsUntilIncl(Dom.nodeAtOffset(range.endContainer, range.endOffset), belowEqCac).pop();
		descendWalkChildrenBeforeAtAfter(range.startContainer, range.startOffset, belowEqCac, Fn.noop, Fn.noop, step, step   );
		descendWalkChildrenBeforeAtAfter(range.endContainer  , range.endOffset  , belowEqCac, Fn.noop, step   , step, Fn.noop);
		if (cacChildStart.parentNode === range.commonAncestorContainer) {
			var node = cacChildStart;
			while (node && node !== cacChildEnd) {
				step(node);
				node = node.nextSibling;
			}
		}
	}

	/**
	 * Walks around the boundaries of the range and calls the given
	 * functions with the nodes it encounters. This algorithm will not
	 * by itself mutate anything, except it will split the text nodes
	 * around the boundaries and adjust the range properties once before
	 * starting the walk.
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
	 * @param range if the range has a commmon ancestor for which
	 * isContext() returns true, then all nodes contained or partially
	 * contained by the range will have clearOverride() invoked on them
	 * (recursively), and all nodes that are descendants of ancestors of
	 * the range containers will have pushDownOverride() invoked on them
	 * (shallowly).
	 *
	 * @param isUpperBoundary args (node); identifies exclusive upper
	 * boundary element, only elements below which will be modified.
	 *
	 * @param getOverride args (node); returns a node's override, or
	 * null if the node does not override the context to set.
	 *
	 * @param clearOverride args (node); should clear any overrides of
	 * the context identified by isContext. Will be called recursively
	 * for all contained nodes in range and for all ancestors of start
	 * and end containers (up to isUpperBoundary or isContext).
	 *
	 * @param pushDownOverride args (node, override); applies the given
	 * override to node; should check whether the given node doesn't
	 * provide its own override, in which case the alternate context
	 * should not be applied.
	 *
	 * @param isContext args (node); determines whether the given node
	 * provides the context that should be pushed down.
	 *
	 * @param setContext args (node); applies the context to the given
	 * node; should clear context recursively to avoid unnecessarily
	 * nested contexts.
	 */
	function apply(range, isUpperBoundary, getOverride, clearOverride, pushDownOverride, isContext, setContext) {
		// Because we should avoid splitTextContainers() if this call is a noop.
		if (range.collapsed) {
			return;
		}
		// Because pushDownContext() requires text boundaries to have
		// offset 0. The split adjusts range containers to become
		// element nodes if necessary.
		Dom.splitTextContainers(range);
		if (!pushDownContext(range, isUpperBoundary, getOverride, clearOverride, pushDownOverride, isContext)) {
			walkTopmostContainedNodes(range, setContext);
		}
	}

	function isEditable() {
		// TODO
		return true;
	}

	var isNotEditable = Fn.complement(isEditable);

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
			if (override) {
				Dom.wrap(node, document.createElement(nodeName));
			}
		}
		function isContext(node) {
			if (unformat) {
				return nodeName !== Dom.childAnParentsUntilIncl(node, function (node) {
					return nodeName === node.nodeName;
				}).pop().nodeName;
			} else {
				return nodeName === node.nodeName;
			}
		}
		function setContext(node) {
			if (unformat) {
				throw "Can't set context for unformat";
			} else {
				Dom.wrap(node, document.createElement(nodeName));
			}
		}
		apply(range, function (node) { return !node.parentNode; }, getOverride, clearOverride, pushDownOverride, isContext, setContext);
	}

	return {
		apply: apply,
		format: format
	};
});
