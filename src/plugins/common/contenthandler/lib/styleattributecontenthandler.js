define([
    'aloha/core',
    'jquery',
    'aloha/contenthandlermanager'
], function(Aloha, jQuery, ContentHandlerManager) {
    var config = null,
        defaults = {
            supportedStyles: {
                'text-align': true
            }
        };

    var init = function() {
        if (!config) {
            config = jQuery.extend(true, {}, defaults, Aloha.settings.contentHandler.handler.styleattribute.allowable);
        }
    };

    var cleanStyles = function(cfg, $el) {
        var style, styleItem, styleItemSplit, styleItems, styles, _i, _len;

        style = $el.attr('style');

        if (style) {
            styleItems = '';
            styles = style.split(';');

            for (_i = 0, _len = styles.length; _i < _len; _i++) {
                styleItem = styles[_i];
                styleItem = styleItem.trim();
                styleItemSplit = styleItem.split(':');

                if (styleItemSplit.length !== 2) continue;

                if (cfg.supportedStyles[styleItemSplit[0].trim()]) {
                    styleItems += "" + styleItem + ";";
                }
            }

            $el.removeAttr('style');
            if (styleItems) {
                $el.attr('style', "" + styleItems);
            }
        }
    };

    var cleanStyleAttribute = function($content) {
        $content.children().each(function() {
            var $child = jQuery(this);
            cleanStyleAttribute($child);
            cleanStyles(config, $child);
        });
    };

    var StyleAttributeContentHandler = ContentHandlerManager.createHandler({
        handleContent: function(content)  {
            init();

            $content = jQuery('<div/>').append(content);
            cleanStyleAttribute($content);
            return $content.html();
        }
    });

    return StyleAttributeContentHandler;
});