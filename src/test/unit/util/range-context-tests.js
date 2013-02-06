Aloha.require([
	'aloha/core',
	'jquery',
	'util/dom2',
	'util/trees',
	'util/arrays',
	'util/strings',
	'util/range-context',
	'dom-to-xhtml/dom-to-xhtml'
], function (
	Aloha,
	$,
	Dom,
	Trees,
	Arrays,
	Strings,
	RangeContext,
	DomToXhtml
) {
	'use strict';

	module('RangeContext');

	function insertBoundaryMarkers(range) {
		var leftMarkerChar  = (3 === range.startContainer.nodeType ? '[' : '{');
		var rightMarkerChar = (3 === range.endContainer.nodeType   ? ']' : '}');
		Dom.splitTextContainers(range);
		var leftMarker = document.createTextNode(leftMarkerChar);
		var rightMarker = document.createTextNode(rightMarkerChar);
		var start = Dom.cursorFromBoundaryPoint(range.startContainer, range.startOffset);
		var end = Dom.cursorFromBoundaryPoint(range.endContainer, range.endOffset);
		start.insert(leftMarker);
		end.insert(rightMarker);
	}

	/**
	 * @param root must be an element node.
	 */
	function extractBoundaryMarkers(rootElem, range) {
		var markers = ['[', '{', '}', ']'];
		var markersFound = 0;
		function setBoundaryPoint(marker, node) {
			var setFn;
			if (0 === markersFound) {
				setFn = 'setStart';
				if (marker !== '[' && marker !== '{') {
					throw "end marker before start marker";
				}
			} else if (1 === markersFound) {
				setFn = 'setEnd';
				if (marker !== ']' && marker !== '}') {
					throw "start marker before end marker";
				}
			} else {
				throw "Too many markers";
			}
			markersFound += 1;
			if (marker === '[' || marker === ']') {
				var previousSibling = node.previousSibling;
				if (!previousSibling || 3 !== previousSibling.nodeType) {
					previousSibling = document.createTextNode('');
					node.parentNode.insertBefore(previousSibling, node);
				}
				range[setFn].call(range, previousSibling, previousSibling.length);
				// Because we have set a text offset.
				return false;
			} else { // marker === '{' || marker === '}'
				range[setFn].call(range, node.parentNode, Dom.nodeIndex(node));
				// Because we have set a non-text offset.
				return true;
			}
		}
		function extractMarkers(node) {
			if (3 !== node.nodeType) {
				return node;
			}
			var text = node.nodeValue;
			var parts = Strings.splitIncl(text, /[\[\{\}\]]/g);
			// Because modifying every text node when there can be
			// only two markers seems like too much overhead.
			if (!Arrays.contains(markers, parts[0]) && parts.length < 2) {
				return node;
			}
			// Because non-text splits must not be joined again.
			var forceNextSplit = false;
			var replacement = null;
			Arrays.forEach(parts, function (part, i) {
				// Because we don't want to join text nodes we haven't split.
				forceNextSplit = forceNextSplit || (i === 0);
				if (Arrays.contains(markers, part)) {
					forceNextSplit = setBoundaryPoint(part, node);
				} else if (!forceNextSplit && node.previousSibling && 3 === node.previousSibling.nodeType) {
					replacement = node.previousSibling;
					node.previousSibling.insertData(node.previousSibling.length, part);
				} else {
					replacement = document.createTextNode(part);
					node.parentNode.insertBefore(replacement, node);
				}
			});
			return replacement;
		}
		Dom.replaceRec(rootElem, extractMarkers);
		if (2 !== markersFound) {
			throw "Missing one or both markers";
		}
	}

	test('extractBoundaryMarkers, insertBoundaryMarkers', function () {
		function t2(htmlWithBoundaryMarkers) {
			var dom = $(htmlWithBoundaryMarkers)[0];
			var range = Aloha.createRange();
			extractBoundaryMarkers(dom, range);
			equal(DomToXhtml.nodeToXhtml(dom), htmlWithBoundaryMarkers.replace(/[\[\{\}\]]/g, ''));
			insertBoundaryMarkers(range);
			equal(DomToXhtml.nodeToXhtml(dom), htmlWithBoundaryMarkers);
		}
		function t(htmlWithBoundaryMarkers) {
			t2(htmlWithBoundaryMarkers);
			t2(htmlWithBoundaryMarkers
			   .replace(/\{/g, '[')
			   .replace(/\}/g, ']'));
		}
		t('<p>{Some text.}</p>');
		t('<p>Some{ }text.</p>');
		t('<p>{}Some text.</p>');
		t('<p>Some text.{}</p>');
		t('<p>Som{}e text.</p>');
		t('<p>{<b>Some text.</b>}</p>');
		t('<p>12{34<b>Some text.</b>56}78</p>');
		t('<p>{1234<b>Some text.</b>5678}</p>');
		t('<p>1234{<b>Some text.</b>}5678</p>');
	});


	function makeFormatter(nodeName, unformat) {
		return function (dom, range) {
			RangeContext.format(range, nodeName, unformat);
		};
	}

	function testMutation(before, after, mutate) {
		var dom = $(before)[0];
		var range = Aloha.createRange();
		extractBoundaryMarkers(dom, range);
		dom = mutate(dom, range) || dom;
		insertBoundaryMarkers(range);
		equal(DomToXhtml.nodeToXhtml(dom), after);
	}

	test('RangeContext.format', function () {
		var t = function (before, after) {
			testMutation(before, after, makeFormatter('B'));
		};
		t('<p>[Some text.]</p>', '<p>{<b>Some text.</b>}</p>');
		t('<p><b>[Some text.]</b></p>', '<p><b>{Some text.}</b></p>');
		t('<p><b><i>[Some text.]</i></b></p>', '<p><b><i>{Some text.}</i></b></p>');
	});
	test('RangeContext.format unformat', function () {
		var t = function (before, after) {
			testMutation(before, after, makeFormatter('B', true));
		};
		t('<p>[Some text.]</p>', '<p>{Some text.}</p>');
		t('<p><b>[Some text.]</b></p>', '<p>{Some text.}</p>');
		t('<p><b><i>[Some text.]</i></b></p>', '<p><i>{Some text.}</i></p>');
	});
});
