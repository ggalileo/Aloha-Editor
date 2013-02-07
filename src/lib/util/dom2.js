/* dom2.js is part of Aloha Editor project http://aloha-editor.org
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
	'jquery',
	'util/functions',
	'util/maps',
	'util/trees',
	'util/strings',
	'util/browser'
], function (
	$,
	Fn,
	Maps,
	Trees,
	Strings,
	Browser
) {
	'use strict';

	var spacesRx = /\s+/;
	var attrRegex = /\s([^\/<>\s=]+)(?:=(?:"[^"]*"|'[^']*'|[^>\/\s]+))?/g;

	/**
	 * Like insertBefore, inserts firstChild into parent before
	 * refChild, except also inserts all the following siblings of
	 * firstChild.
	 */
	function moveNextAll(parent, firstChild, refChild) {
		while (firstChild) {
			var nextChild = firstChild.nextSibling;
			parent.insertBefore(firstChild, refChild);
			firstChild = nextChild;
		}
	}

	/**
	 * Retrieves the names of all attributes from the given elmenet.
	 *
	 * Correctly handles the case that IE7 and IE8 have approx 70-90
	 * default attributes on each and every element.
	 *
	 * This implementation does not iterate over the elem.attributes
	 * property since that is much slower on IE7 (even when
	 * checking the attrNode.specified property). Instead it parses the
	 * HTML of the element. For elements with few attributes the
	 * performance on IE7 is improved by an order of magnitued.
	 *
	 * On IE7, when you clone a <button disabled="disabled"/> or an
	 * <input checked="checked"/> element the boolean properties will
	 * not be set on the cloned node. We choose the speed optimization
	 * over correctness in this case. The dom-to-xhtml plugin has a
	 * workaround for this case.
	 */
	function attrNames(elem) {
		var names = [];
		var html = elem.cloneNode(false).outerHTML;
		var match;
		while (null != (match = attrRegex.exec(html))) {
			names.push(match[1]);
		}
		return names;
	}

	/**
	 * Gets the attributes of the given element.
	 *
	 * See attrNames() for an edge case on IE7.
	 *
	 * @param elem
	 *        An element to get the attributes for.
	 * @return
	 *        An array containing [name, value] tuples for each attribute.
	 *        Attribute values will always be strings, but possibly empty strings.
	 */
	function attrs(elem) {
		var as = [];
		var names = attrNames(elem);
		var i;
		var len;
		for (i = 0, len = names.length; i < len; i++) {
			var name = names[i];
			var value = $.attr(elem, name);
			if (null == value) {
				value = "";
			} else {
				value = value.toString();
			}
			as.push([name, value]);
		}
		return as;
	}

	/**
	 * Like indexByClass() but operates on a list of elements instead.
	 * The given list may be a NodeList, HTMLCollection, or an array.
	 */
	function indexByClassHaveList(elems, classMap) {
		var index = {},
		    indexed,
		    classes,
		    elem,
		    cls,
		    len,
		    i,
		    j;
		for (i = 0, len = elems.length; i < len; i++) {
			elem = elems[i];
			if (elem.className) {
				classes = Strings.words(elem.className);
				for (j = 0; j < classes.length; j++) {
					cls = classes[j];
					if (classMap[cls]) {
						indexed = index[cls];
						if (indexed) {
							indexed.push(elem);
						} else {
							index[cls] = [elem];
						}
					}
				}
			}
		}
		return index;
	}

	/**
	 * Indexes descendant elements based on the individual classes in
	 * the class attribute.
	 *
	 * Based on these observations;
	 * 
	 * * $('.class1, .class2') takes twice as long as $('.class1') on IE7.
	 *
	 * * $('.class1, .class2') is fast on IE8 (approx the same as
	 *   $('.class'), no matter how many classes), but if the individual
	 *   elements in the result set should be handled differently, the
	 *   subsequent hasClass('.class1') and hasClass('.class2') calls
	 *   slow things down again.
	 *
	 * * DOM traversal with elem.firstChild elem.nextSibling is very
	 *   slow on IE7 compared to just iterating over
	 *   root.getElementsByTagName('*').
	 *
	 * * $('name.class') is much faster than just $('.class'), but as
	 *   soon as you need a single class in classMap that may be present
	 *   on any element, that optimization doesn't gain anything since
	 *   then you have to examine every element.
	 *
	 * This function will always take approx. the same amount of time
	 * (on IE7 approx. equivalent to a single call to $('.class')) no
	 * matter how many entries there are in classMap to index.
	 *
	 * This function only makes sense for multiple entries in
	 * classMap. For a single class lookup, $('.class') or
	 * $('name.class') is fine (even better in the latter case).
	 *
	 * @param root
	 *        The root element to search for elements to index
	 *        (will not be included in search).
	 * @param classMap
	 *        A map from class name to boolean true.
	 * @return
	 *        A map from class name to an array of elements with that class.
	 *        Every entry in classMap for which elements have been found
	 *        will have a corresponding entry in the returned
	 *        map. Entries for which no elements have been found, may or
	 *        may not have an entry in the returned map.
	 */
	function indexByClass(root, classMap) {
		var elems;
		if (Browser.ie7) {
			elems = root.getElementsByTagName('*');
		} else {
			// Optimize for browsers that support querySelectorAll/getElementsByClassName.
			// On IE8 for example, if there is a relatively high
			// elems/resultSet ratio, performance can improve by a factor of 2.
			elems = $(root).find('.' + Maps.keys(classMap).join(',.'));
		}
		return indexByClassHaveList(elems, classMap);
	}

	/**
	 * Indexes descendant elements based on elem.nodeName.
	 *
	 * Based on these observations:
	 *
	 * * On IE8, for moderate values of names.length, individual calls to
	 *   getElementsByTagName is just as fast as $root.find('name, name,
	 *   name, name').
	 *
	 * * On IE7, $root.find('name, name, name, name') is extemely slow
	 *   (can be an order of magnitude slower than individual calls to
	 *    getElementsByTagName, why is that?).
	 *
	 * * Although getElementsByTagName is very fast even on IE7, when
	 *   names.length > 7 an alternative implementation that iterates
	 *   over all tags and checks names from a hashmap (similar to how
	 *   indexByClass does it) may become interesting, but
	 *   names.length > 7 is unlikely.
	 *
	 * This function only makes sense if the given names array has many
	 * entries. For only one or two different names, calling $('name')
	 * or context.getElementsByTagName(name) directly is fine (but
	 * beware of $('name, name, ...') as explained above).
	 *
	 * The signature of this function differs from indexByClass by not
	 * taking a map but instead an array of names.
	 *
	 * @param root
	 *        The root element to search for elements to index
	 *        (will not be included in search).
	 * @param names
	 *        An array of element names to look for.
	 *        Names must be in all-uppercase (the same as elem.nodeName).
	 * @return
	 *        A map from element name to an array of elements with that name.
	 *        Names will be all-uppercase.
	 *        Arrays will be proper arrays, not NodeLists.
	 *        Every entry in classMap for which elements have been found
	 *        will have a corresponding entry in the returned
	 *        map. Entries for which no elements have been found, may or
	 *        may not have an entry in the returned map.
	 */
	function indexByName(root, names) {
		var i,
		    index = {},
		    len;
		for (i = 0, len = names.length; i < len; i++) {
			var name = names[i];
			index[name] = $.makeArray(root.getElementsByTagName(name));
		}
		return index;
	}

	function isAtEnd(node, offset) {
		return 1 === node.nodeType
			&& offset >= node.childNodes.length
			|| 3 === node.nodeType
			&& offset === node.length
			&& !node.nextSibling;
	}

	/**
	 * @param node if a text node, should have a parent node.
	 */
	function nodeAtOffset(node, offset) {
		if (1 === node.nodeType && offset < node.childNodes.length) {
			node = node.childNodes[offset];
		} else if (3 === node.nodeType && offset === node.length) {
			node = node.nextSibling || node.parentNode;
		}
		return node;
	}

	function Cursor(node, atEnd) {
		this.node = node;
		this.atEnd = atEnd;
	}

	/**
	 * A cursor has the added utility over other iteration methods of
	 * iterating over the end position of an element. The start and end
	 * positions of an element are immediately before and after the
	 * first and last child respectively. All node positions except end
	 * positions can be identified just by a node. To distinguish
	 * between element start and end positions, the additional atEnd
	 * boolean is necessary.
	 */
	function cursor(node, atEnd) {
		return new Cursor(node, atEnd);
	}

	Cursor.prototype.next = function () {
		var node = this.node;
		var atEnd = this.atEnd;
		var next;
		if (atEnd) {
			next = node.nextSibling;
			atEnd = false;
			if (!next) {
				next = node.parentNode;
				atEnd = true;
				if (!next) {
					return false;
				}
			}
		} else {
			next = node.firstChild;
			if (!next) {
				atEnd = true;
			}
		}
		this.node = next;
		this.atEnd = atEnd;
		return true;
	};

	Cursor.prototype.equals = function (cursor) {
		return cursor.node === this.node && cursor.atEnd === this.atEnd;
	};

	Cursor.prototype.clone = function (cursor) {
		return cursor(cursor.node, cursor.atEnd);
	};

	Cursor.prototype.insert = function (node) {
		if (this.atEnd) {
			this.node.appendChild(node);
		} else {
			this.node.parentNode.insertBefore(node, this.node);
		}
	};

	/**
	 * @param offset if node is a text node, the offset will be ignored.
	 * @param node if a text node, should have a parent node.
	 */
	function cursorFromBoundaryPoint(node, offset) {
		return cursor(nodeAtOffset(node, offset), isAtEnd(node, offset));
	}

	function parentsUntil(node, pred) {
		var parents = [];
		var parent = node.parentNode;
		while (parent && !pred(parent)) {
			parents.push(parent);
			parent = parent.parentNode;
		}
		return parents;
	}

	function parentsUntilIncl(node, pred) {
		var parents = parentsUntil(node, pred);
		var topmost = parents.length ? parents[parents.length - 1] : node;
		if (topmost && topmost.parentNode) {
			parents.push(topmost.parentNode);
		}
		return parents;
	}

	function childAndParentsUntil(node, pred) {
		if (pred(node)) {
			return [];
		}
		var parents = parentsUntil(node, pred);
		parents.unshift(node);
		return parents;
	}

	function childAndParentsUntilIncl(node, pred) {
		if (pred(node)) {
			return [node];
		}
		var parents = parentsUntilIncl(node, pred);
		parents.unshift(node);
		return parents;
	}

	function splitTextNode(node, offset) {
		// Because node.splitText() is buggy on IE, split it manually.
		// http://www.quirksmode.org/dom/w3c_core.html
		var parent = node.parentNode;
		var text = node.nodeValue;
		if (0 === offset || offset >= text.length) {
			return node;
		}
		var before = document.createTextNode(text.substring(0, offset))
		var after = document.createTextNode(text.substring(offset, text.length));
		parent.insertBefore(before, node);
		parent.insertBefore(after, node);
		parent.removeChild(node);
		return before;
	}

	function adjustRangeAfterSplit(range, container, offset, setProp, splitNode, newNodeBeforeSplit) {
		if (container !== splitNode) {
			return;
		}
		var newNodeLength = newNodeBeforeSplit.length;
		if (offset === 0) {
			container = newNodeBeforeSplit.parentNode;
			offset = nodeIndex(newNodeBeforeSplit);
		} else if (offset < newNodeLength) {
			container = newNodeBeforeSplit;
		} else if (offset === newNodeLength) {
			container = newNodeBeforeSplit.parentNode;
			offset = nodeIndex(newNodeBeforeSplit) + 1;
		} else {// offset > newNodeLength
			var newNodeAfterSplit = newNodeBeforeSplit.nextSibling;
			container = newNodeAfterSplit;
			offset -= newNodeLength;
		}
		range[setProp].call(range, container, offset);
	}

	function splitNodeAdjustRange(splitNode, splitOffset, sc, so, ec, eo, range) {
		if (3 !== splitNode.nodeType) {
			return;
		}
		var newNodeBeforeSplit = splitTextNode(splitNode, splitOffset);
		adjustRangeAfterSplit(range, sc, so, 'setStart', splitNode, newNodeBeforeSplit);
		adjustRangeAfterSplit(range, ec, eo, 'setEnd', splitNode, newNodeBeforeSplit);
	}

	function splitTextContainers(range) {
		var sc = range.startContainer;
		var so = range.startOffset;
		var ec = range.endContainer;
		var eo = range.endOffset;
		splitNodeAdjustRange(sc, so, sc, so, ec, eo, range);
		// Because the range may have been adjusted.
		sc = range.startContainer;
		so = range.startOffset;
		ec = range.endContainer;
		eo = range.endOffset;
		splitNodeAdjustRange(ec, eo, sc, so, ec, eo, range);
	}

	function nodeIndex(node) {
		var ret = 0;
		while (node.previousSibling) {
			ret++;
			node = node.previousSibling;
		}
		return ret;
	}

	function adjustRangeAfterUnwrap(range, container, offset, node) {
		if (container === node) {
			return [node.parentNode, offset + nodeIndex(node)];
		}
		if (container === node.parentNode && offset > nodeIndex(node)) {
			return [node.parentNode, offset + node.childNodes.length];
		}
		return null;
	}

	/**
	 * Adjusted range may be outside wrapper.
	 */
	function adjustRangeAfterWrap(range, container, offset, node, wrapper) {
		// Nothing to do - the range will be automatically correct after
		// the node is wrapped.
		return null;
	}

	function adjustRange(range, adjust, mutate, arg1, arg2) {
		// Because we mustn't set an invalid range, we must set it only
		// after performing the mutation.
		var adjustStart, adjustEnd;
		if (range) {
			adjustStart = adjust(range, range.startContainer, range.startOffset, arg1, arg2);
			adjustEnd   = adjust(range, range.endContainer, range.endOffset, arg1, arg2);
		}
		mutate(arg1, arg2);
		if (adjustStart) {
			range.setStart.apply(range, adjustStart);
		}
		if (adjustEnd) {
			range.setEnd.apply(range, adjustEnd);
		}
	}

	function shallowRemove(node, range) {
		adjustRange(range, adjustRangeAfterUnwrap, function (node) {
			var parent = node.parentNode;
			moveNextAll(parent, node.firstChild, node);
			parent.removeChild(node);
		}, node);
	}

	function wrap(node, wrapper, range) {
		adjustRange(range, adjustRangeAfterWrap, function (node, wrapper) {
			node.parentNode.replaceChild(wrapper, node);
			wrapper.appendChild(node);
		}, node, wrapper);
	}

	function walkUntil(node, fn, until) {
		while (node && !until(node)) {
			node = fn(node);
		}
		return node;
	}

	function walk(node, fn) {
		walkUntil(node, fn, Fn.returnFalse);
	}

	function walkRec(node, fn) {
		if (1 === node.nodeType) {
			walk(node.firstChild, function (node) {
				return walkRec(node, fn);
			});
		}
		return fn(node);
	}

	return {
		moveNextAll: moveNextAll,
		attrNames: attrNames,
		attrs: attrs,
		indexByClass: indexByClass,
		indexByName: indexByName,
		indexByClassHaveList: indexByClassHaveList,
		cursor: cursor,
		cursorFromBoundaryPoint: cursorFromBoundaryPoint,
		nodeAtOffset: nodeAtOffset,
		isAtEnd: isAtEnd,
		parentsUntil: parentsUntil,
		parentsUntilIncl: parentsUntilIncl,
		childAndParentsUntil: childAndParentsUntil,
		childAndParentsUntilIncl: childAndParentsUntilIncl,
		nodeIndex: nodeIndex,
		splitTextNode: splitTextNode,
		splitTextContainers: splitTextContainers,
		shallowRemove: shallowRemove,
		wrap: wrap,
		walk: walk,
		walkRec: walkRec,
		walkUntil: walkUntil
	};
});
