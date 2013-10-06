(function(){

  var clone = fabric.util.object.clone;

   /**
    * IText class
    * @class fabric.IText
    * @extends fabric.Text
    * @fires #text:changed
    * @return {fabric.IText} thisArg
    */
  fabric.IText = fabric.util.createClass(fabric.Text, fabric.Observable, {

    /**
     * Type of an object
     * @type String
     * @default
     */
    type: 'i-text',

    /**
     * Index where text selection starts (or where cursor is when there is no selection)
     * @type Nubmer
     * @default
     */
    selectionStart: 0,

    /**
     * Index where text selection ends
     * @type Nubmer
     * @default
     */
    selectionEnd: 0,

    /**
     * Color of text selection
     * @type String
     * @default
     */
    selectionColor: 'rgba(17,119,255,0.3)',

    /**
     * Indicates whether text is in editing mode
     * @type Boolean
     * @default
     */
    isEditing: false,

    /**
     * Border color of text object while it's in editing mode
     * @type String
     * @default
     */
    editingBorderColor: 'rgba(102,153,255,0.25)',

    /**
     * Width of cursor (in px)
     * @type Number
     * @default
     */
    cursorWidth: 2,

    /**
     * Color of default cursor (when not overwritten by character style)
     * @type String
     * @default
     */
    cursorColor: '#333',

    /**
     * Delay between cursor blink (in ms)
     * @type Number
     * @default
     */
    cursorDelay: 1000,

    /**
     * Duration of cursor fadein (in ms)
     * @type Number
     * @default
     */
    cursorDuration: 600,

    /**
     * Object containing character styles
     * (where top-level properties corresponds to line number and 2nd-level properties — to char number in a line)
     * @type Object
     * @default
     */
    styles: null,

    skipFillStrokeCheck: true,

    _reNewline: /\r?\n/,
    _fontSizeFraction: 4,
    _currentCursorOpacity: 0,
    _selectionDirection: null,
    _abortCursorAnimation: false,

    /**
     * Constructor
     * @param {String} text Text string
     * @param {Object} [options] Options object
     * @return {fabric.IText} thisArg
     */
    initialize: function(text, options) {
      this.styles = options.styles || { };

      this.callSuper('initialize', text, options);

      fabric.util.addListener(document, 'keydown', this.onKeyUp.bind(this));
      fabric.util.addListener(document, 'keypress', this.onKeyPress.bind(this));

      this.initCursorSelectionHandlers();
      this.initDblClickSimulation();

      this.dummyTextarea = document.createElement('textarea');
      this.dummyTextarea.style.cssText = 'position: absolute; top: -9999px; left: -9999px;';
      document.body.appendChild(this.dummyTextarea);
    },

    /**
     * Initializes "dbclick" event handler
     */
    initDblClickSimulation: function() {
      var lastClickTime = +new Date;
      var newClickTime;
      this.on('mousedown', function(options) {
        newClickTime = +new Date;
        if (newClickTime - lastClickTime < 500) {
          this.fire('dblclick', options);

          var event = options.e;

          event.preventDefault && event.preventDefault()
          event.stopPropagation && event.stopPropagation();
        }
        lastClickTime = newClickTime;
      });
    },

    /**
     * Initializes event handlers related to cursor or selection
     */
    initCursorSelectionHandlers: function() {
      var _this = this;

      this.initSelectedHandler();

      this.initMousedownHandler();
      this.initMousemoveHandler();
      this.initMouseupHandler();

      this.on('dblclick', function(options) {
        this.selectWord(this.getSelectionStartFromPointer(options.e));
      });
    },

    /**
     * Initializes "mousedown" event handler
     */
    initMousedownHandler: function() {
      this.on('mousedown', function(options) {
        var pointer = this.canvas.getPointer(options.e);

        this.__mousedownX = pointer.x;
        this.__mousedownY = pointer.y;
        this.__isMousedown = true;

        if (this.isEditing) {
          this.setCursorByClick(options.e);
        }
      });
    },

    /**
     * Initializes "mousemove" event handler
     */
    initMousemoveHandler: function() {
      this.on('mousemove', function() {
        if (this.__isMousedown && this.isEditing) {
          console.log('mousemove: need to select text');
        }
      });
    },

    /**
     * Initializes "mouseup" event handler
     */
    initMouseupHandler: function() {
      this.on('mouseup', function(options) {
        this.__isMousedown = false;

        var pointer = this.canvas.getPointer(options.e);

        var isObjectMoved = this.__mousedownX !== pointer.x ||
                            this.__mousedownY !== pointer.y;

        if (isObjectMoved) return;

        if (this.selected) {
          this.enterEditing();
        }
      });
    },

    /**
     * Initializes "selected" event handler
     */
    initSelectedHandler: function() {
      this.on('selected', function() {

        var _this = this;
        setTimeout(function() {
          _this.selected = true;
        }, 100);

        if (!this._hasClearSelectionListener) {
          this.canvas.on('selection:cleared', function(options) {
            // do not exit editing if event fired when clicking on an object again (in editing mode)
            if (_this.canvas.findTarget(options.e)) return;
            _this.exitEditing();
          });

          this._hasClearSelectionListener = true;
        }
      });
    },

    setSelectionStart: function(index) {
      this.selectionStart = index;
      this.dummyTextarea.selectionStart = index;
    },

    setSelectionEnd: function(index) {
      this.selectionEnd = index;
      this.dummyTextarea.selectionEnd = index;
    },

    /**
     * Selects a word based on the index
     * @param {Number} selectionStart Index of a character
     */
    selectWord: function(selectionStart) {

      function searchWordBoundary(direction) {
        var index = selectionStart;
        var _char = this.text.charAt(index);
        var reNonWord = /[ \n\.,;!\?\-]/;

        while (!reNonWord.test(_char) && index > 0 && index < this.text.length) {
          index += direction;
          _char = this.text.charAt(index);
        }
        if (reNonWord.test(_char) && _char !== '\n') {
          index += direction === 1 ? 0 : 1;
        }
        return index;
      }

      var newSelectionStart = searchWordBoundary.call(this, -1) /* search backwards */;
      var newSelectionEnd = searchWordBoundary.call(this, 1) /* search forward */;

      this.setSelectionStart(newSelectionStart);
      this.setSelectionEnd(newSelectionEnd);
    },

    /**
     * Returns coordinates of a pointer relative to an object
     * @return {Object} Coordinates of a pointer (x, y)
     */
    getLocalPointer: function(e) {
      var pointer = this.canvas.getPointer(e);
      var objectLeftTop = this.translateToOriginPoint(this.getCenterPoint(), 'left', 'top');
      return {
        x: pointer.x - objectLeftTop.x,
        y: pointer.y - objectLeftTop.y
      };
    },

    /**
     * Changes cursor location in a text depending on passed pointer (x/y) object
     * @param {Object} pointer Pointer object with x and y numeric properties
     */
    setCursorByClick: function(e) {
      var newSelectionStart = this.getSelectionStartFromPointer(e);
      this.setSelectionStart(newSelectionStart);
      this.setSelectionEnd(newSelectionStart);
    },

    /**
     * Returns index of a character corresponding to where an object was clicked
     * @param {Event} e Event object
     * @return {Number} Index of a character
     */
    getSelectionStartFromPointer: function(e) {
      var localPointer = this.getLocalPointer(e);
      var mouseOffsetX = localPointer.x;
      var mouseOffsetY = localPointer.y;

      var textLines = this.text.split(this._reNewline);
      var prevWidth = 0;
      var width = 0;
      var height = 0;
      var charIndex = 0;
      var newSelectionStart;

      for (var i = 0, len = textLines.length; i < len; i++) {
        height += this._getHeightOfLine(this.ctx, i);

        var widthOfLine = this._getWidthOfLine(this.ctx, i, textLines);
        var lineLeftOffset = this._getLineLeftOffset(widthOfLine);

        width = lineLeftOffset;

        for (var j = 0, jlen = textLines[i].length; j < jlen; j++) {
          var _char = textLines[i][j];
          prevWidth = width;
          width += this._getWidthOfChar(this.ctx, _char, i, j);

          // debugging
          // var objectLeftTop = this.translateToOriginPoint(this.getCenterPoint(), 'left', 'top');
          // var _this = this;
          // setTimeout(function() {
          //   _this.canvas.upperCanvasEl.getContext('2d')
          //     .strokeRect(objectLeftTop.x, objectLeftTop.y, width, height);
          // }, 100)

          if (height > mouseOffsetY && width > mouseOffsetX) {

            var distanceBtwLastCharAndCursor = mouseOffsetX - prevWidth;
            var distanceBtwNextCharAndCursor = width - mouseOffsetX;

            // console.log(prevWidth, mouseOffsetX, width);
            // console.log(distanceBtwLastCharAndCursor, distanceBtwNextCharAndCursor);

            if (distanceBtwNextCharAndCursor > distanceBtwLastCharAndCursor) {
              newSelectionStart = charIndex + i;
              // console.log('leaning left');
            }
            else {
              // console.log('leaning right');
              newSelectionStart = charIndex + i + 1;
            }

            // console.log('newSelectionStart', newSelectionStart);

            if (newSelectionStart > this.text.length) {
              newSelectionStart = this.text.length;
            }

            this.canvas.renderAll();
            return newSelectionStart;
          }

          charIndex++
        }
      }
    },

    /**
     * Enters editing state
     * @return {fabric.IText} thisArg
     * @chainable
     */
    enterEditing: function() {
      if (this.isEditing) return;

      this.isEditing = true;

      this.dummyTextarea.value = this.text;
      this.dummyTextarea.selectionStart = this.selectionStart;
      this.dummyTextarea.focus();

      this._savedProps = {

        hasControls: this.hasControls,
        borderColor: this.borderColor,
        lockMovementX: this.lockMovementX,
        lockMovementY: this.lockMovementY,

        hoverCursor: this.hoverCursor,
        defaultCursor: this.canvas.defaultCursor,
        moveCursor: this.canvas.moveCursor
      };

      this.hoverCursor = 'text';
      this.canvas.defaultCursor = 'text';
      this.canvas.moveCursor = 'text';

      this.hasControls = false;
      this.borderColor = this.editingBorderColor;
      this.selectable = false;
      this.lockMovementX = true;
      this.lockMovementY = true;

      this._tick();
      this.canvas.renderAll();

      return this;
    },

    /**
     * Exits from editing state
     * @return {fabric.IText} thisArg
     * @chainable
     */
    exitEditing: function() {

      this.selected = false;
      this.isEditing = false;
      this.selectable = true;

      this.dummyTextarea.blur();

      this.abortCursorAnimation();

      if (this._savedProps) {
        this.hoverCursor = this._savedProps.overCursor;
        this.canvas.defaultCursor = this._savedProps.defaultCursor;
        this.canvas.moveCursor = this._savedProps.moveCursor;

        this.hasControls = this._savedProps.hasControls;
        this.borderColor = this._savedProps.borderColor;
        this.lockMovementX = this._savedProps.lockMovementX;
        this.lockMovementY = this._savedProps.lockMovementY;
      }

      this._currentCursorOpacity = 0;

      return this;
    },

    /**
     * Gets style of a current selection/cursor (at the start position)
     * @return {Object} styles Style object at a cursor position
     */
    getSelectionStyles: function() {
      var loc = this.get2DCursorLocation();
      if (this.styles[loc.lineIndex]) {
        return this.styles[loc.lineIndex][loc.charIndex] || { };
      }
      return { };
    },

    /**
     * Sets style of a current selection
     * @param {Object} [styles] Styles object
     * @return {fabric.IText} thisArg
     * @chainable
     */
    setSelectionStyles: function(styles) {

      function setStyle(i) {
        var loc = this.get2DCursorLocation(i);

        if (!this.styles[loc.lineIndex]) {
          this.styles[loc.lineIndex] = { };
        }
        if (!this.styles[loc.lineIndex][loc.charIndex]) {
          this.styles[loc.lineIndex][loc.charIndex] = { };
        }

        fabric.util.object.extend(this.styles[loc.lineIndex][loc.charIndex], styles);
      }

      if (this.selectionStart === this.selectionEnd) {
        setStyle.call(this, this.selectionStart);
      }
      else {
        for (var i = this.selectionStart; i < this.selectionEnd; i++) {
          setStyle.call(this, i);
        }
      }

      return this;
    },

    _tick: function() {
      var _this = this;

      if (this._abortCursorAnimation) return;

      this.animate('_currentCursorOpacity', 1, {

        duration: this.cursorDuration,

        onComplete: function() {
          _this._onTickComplete();
        },

        onChange: function() {
          // console.log('change', this._abortCursorAnimation);
          _this.canvas && _this.canvas.renderAll();
        },

        abort: function() {
          return _this._abortCursorAnimation;
        }
      });
    },

    _onTickComplete: function() {
      if (this._abortCursorAnimation) return;

      var _this = this;
      if (this._cursorTimeout1) {
        clearTimeout(this._cursorTimeout1);
      }
      this._cursorTimeout1 = setTimeout(function() {
        _this.animate('_currentCursorOpacity', 0, {
          duration: this.cursorDuration / 2,
          onComplete: function() {
            _this._tick();
          },
          onChange: function() {
            // console.log('change', this._abortCursorAnimation);
            _this.canvas && _this.canvas.renderAll();
          },
          abort: function() {
            return _this._abortCursorAnimation;
          }
        });
      }, 100);
    },

    /**
     * Initializes delayed cursor
     */
    initDelayedCursor: function() {
      var _this = this;
      if (this._cursorTimeout2) {
        clearTimeout(this._cursorTimeout2);
      }
      this._cursorTimeout2 = setTimeout(function() {
        _this._abortCursorAnimation = false;
        _this._tick();
      }, this.cursorDelay);
    },

    /**
     * Handles keyup event
     * @param {Event} e Event object
     */
    onKeyUp: function(e) {
      if (!this.isEditing || e.metaKey || e.ctrlKey) return;

      if (e.keyCode === 39) {
        this.moveCursorRight(e);
      }
      else if (e.keyCode === 37) {
        this.moveCursorLeft(e);
      }
      else if (e.keyCode === 38) {
        this.moveCursorUp(e);
      }
      else if (e.keyCode === 40) {
        this.moveCursorDown(e);
      }
      else if (e.keyCode === 8) {
        this.removeChar();
      }
      else if (e.keyCode === 13) {
        this.insertNewline();
      }
      else {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      this.canvas && this.canvas.renderAll();
    },

    /**
     * Handles keypress event
     * @param {Event} e Event object
     */
    onKeyPress: function(e) {
      if (!this.isEditing || e.metaKey || e.ctrlKey) return;

      this.insertChar(String.fromCharCode(e.which));

      e.preventDefault();
      e.stopPropagation();
    },

    /**
     * Gets start offset of a selection
     * @return {Number}
     */
    getSelectionStartOffset: function() {
      var textBeforeCursor = this.text.slice(0, this.selectionStart);
      var textAfterCursor = this.text.slice(this.selectionStart);

      var textOnSameLineBeforeCursor = textBeforeCursor.slice(textBeforeCursor.lastIndexOf('\n') + 1);
      var textOnSameLineAfterCursor = textAfterCursor.match(/(.*)\n?/)[1];
      var textOnNextLine = textAfterCursor.match(/.*\n(.*)\n?/)[1];

      if (textOnSameLineBeforeCursor.length > textOnNextLine.length) {
        return (textOnNextLine + textOnSameLineAfterCursor).length + 1;
      }
      else {
        return (textOnSameLineBeforeCursor + textOnSameLineAfterCursor).length + 1;
      }
    },

    /**
     * Returns true if there is a newline after cursor
     * @return {Boolean}
     */
    hasNewLinesAfterCursor: function() {
      var textAfterCursor = this.text.slice(this.selectionStart);
      return textAfterCursor.indexOf('\n') > -1;
    },

    /**
     * Moves cursor down
     * @param {Event} e Event object
     */
    moveCursorDown: function(e) {
      if (!this.hasNewLinesAfterCursor()) return;
      this.abortCursorAnimation();
      this._currentCursorOpacity = 1;

      var offset = this.getSelectionStartOffset();

      if (e.shiftKey) {
        this.moveCursorDownWithShift(offset);
      }
      else {
        this.moveCursorDownWithoutShift(offset);
      }

      this.initDelayedCursor();
    },

    moveCursorDownWithoutShift: function(offset) {
      this.selectionStart += offset;

      if (this.selectionStart > this.text.length) {
        this.selectionStart = this.text.length;
      }
      this.selectionEnd = this.selectionStart;
    },

    moveCursorDownWithShift: function(offset) {
      this._selectionDirection = 'right';
      this.selectionEnd += offset;

      if (this.selectionEnd > this.text.length) {
        this.selectionEnd = this.text.length;
      }
    },

    /**
     * Moves cursor up
     * @param {Event} e Event object
     */
    moveCursorUp: function(e) {

      var textBeforeCursor = this.text.slice(0, this.selectionStart);

      var hasNewLines = textBeforeCursor.indexOf('\n') > -1;
      if (!hasNewLines) return;

      this.abortCursorAnimation();
      this._currentCursorOpacity = 1;

      var textOnSameLineBeforeCursor = textBeforeCursor.slice(textBeforeCursor.lastIndexOf('\n') + 1);
      var textOnPreviousLine = textBeforeCursor.match(/\n?(.*)\n.*$/)[1];

      if (textOnSameLineBeforeCursor.length > textOnPreviousLine.length) {
        this.selectionStart -= textOnSameLineBeforeCursor.length + 1;
      }
      else {
        this.selectionStart -= textOnPreviousLine.length + 1;
      }
      if (e.shiftKey) {
        this._selectionDirection = 'left';
      }
      else {
        this.selectionEnd = this.selectionStart;
      }

      this.initDelayedCursor();
    },

    /**
     * Moves cursor left
     * @param {Event} e Event object
     */
    moveCursorLeft: function(e) {
      if (this.selectionStart === 0 && this.selectionEnd === 0) return;

      this.abortCursorAnimation();
      this._currentCursorOpacity = 1;

      if (e.shiftKey) {
        this.moveCursorLeftWithShift();
      }
      else {
        this.moveCursorLeftWithoutShift();
      }

      this.initDelayedCursor();
    },

    moveCursorLeftWithoutShift: function() {
      this._selectionDirection = 'left';

      // only move cursor when there is no selection,
      // otherwise we discard it, and leave cursor on same place
      if (this.selectionEnd === this.selectionStart) {
        this.selectionStart--;
      }
      this.selectionEnd = this.selectionStart;
    },

    moveCursorLeftWithShift: function() {
      if (this._selectionDirection === 'right' && this.selectionStart !== this.selectionEnd) {
        this.selectionEnd--;
      }
      else {
        this._selectionDirection = 'left';
        this.selectionStart--;

        // increase selection by one if it's a newline
        if (this.text.charAt(this.selectionStart) === '\n') {
          this.selectionStart--;
        }
        if (this.selectionStart < 0) {
          this.selectionStart = 0;
        }
      }
    },

    /**
     * Moves cursor right
     * @param {Event} e Event object
     */
    moveCursorRight: function(e) {
      if (this.selectionStart >= this.text.length && this.selectionEnd >= this.text.length) return;

      this.abortCursorAnimation();
      this._currentCursorOpacity = 1;

      if (e.shiftKey) {
        this.moveCursorRightWithShift();
      }
      else {
        this.moveCursorRightWithoutShift();
      }

      this.initDelayedCursor();
    },

    moveCursorRightWithShift: function() {
      if (this._selectionDirection === 'left' && this.selectionStart !== this.selectionEnd) {
        this.selectionStart++;
      }
      else {
        this._selectionDirection = 'right';
        this.selectionEnd++;

        // increase selection by one if it's a newline
        if (this.text.charAt(this.selectionEnd - 1) === '\n') {
          this.selectionEnd++;
        }
        if (this.selectionEnd > this.text.length) {
          this.selectionEnd = this.text.length;
        }
      }
    },

    moveCursorRightWithoutShift: function() {
      this._selectionDirection = 'right';

      if (this.selectionStart === this.selectionEnd) {
        this.selectionStart++;
        this.selectionEnd = this.selectionStart;
      }
      else {
        this.selectionEnd += this.getNumNewLinesInSelectedText();
        if (this.selectionEnd > this.text.length) {
          this.selectionEnd = this.text.length;
        }
        this.selectionStart = this.selectionEnd;
      }
    },

    /**
     * Returns number of newlines in selected text
     * @return {Number}
     */
    getNumNewLinesInSelectedText: function() {
      var selectedText = this.text.slice(this.selectionStart, this.selectionEnd);
      var numNewLines = 0;
      for (var i = 0, chars = selectedText.split(''), len = chars.length; i < len; i++) {
        if (chars[i] === '\n') {
          numNewLines++;
        }
      }
      return numNewLines;
    },

    /**
     * Aborts cursor animation and clears all timeouts
     */
    abortCursorAnimation: function() {
      this._abortCursorAnimation = true;

      clearTimeout(this._cursorTimeout1);
      clearTimeout(this._cursorTimeout2);

      this._currentCursorOpacity = 0;
      this.canvas.renderAll();

      var _this = this;
      setTimeout(function() {
        _this._abortCursorAnimation = false;
      }, 10);
    },

    /**
     * Inserts a character where cursor is (replacing selection if one exists)
     */
    removeChar: function() {
      if (this.selectionStart === this.selectionEnd) {
        if (this.selectionStart !== 0) {

          var isBeginningOfLine = this.text.slice(this.selectionStart-1, this.selectionStart) === '\n';
          this.removeStyleObject(isBeginningOfLine);

          this.selectionStart--;
          this.text = this.text.slice(0, this.selectionStart) +
                      this.text.slice(this.selectionStart + 1);
        }
      }
      else {
        var start = this.selectionStart;
        var end = this.selectionEnd;
        while (end !== start) {
          end--;
          //var isBeginningOfLine = this.text.slice(end - 1, end) === '\n';
          this.removeStyleObject(false, end);
        }

        this.text = this.text.slice(0, this.selectionStart) +
                    this.text.slice(this.selectionEnd);
      }

      this.selectionEnd = this.selectionStart;

      this.setCoords();
      this.fire('text:changed');
    },

    /**
     * Inserts a character where cursor is (replacing selection if one exists)
     * @param {String} _char Character to insert
     */
    insertChar: function(_char) {
      var isEndOfLine = this.text.slice(this.selectionStart, this.selectionStart + 1) === '\n';

      this.text = this.text.slice(0, this.selectionStart) +
                    _char +
                  this.text.slice(this.selectionEnd);

      if (this.selectionStart === this.selectionEnd) {
        this.insertStyleObject(_char, isEndOfLine);
      }
      else if (this.selectionEnd - this.selectionStart > 1) {
        // TODO: replace styles properly
        // console.log('replacing MORE than 1 char');
      }

      this.selectionStart++;
      this.selectionEnd = this.selectionStart;

      this.canvas && this.canvas.renderAll();

      this.setCoords();
      this.fire('text:changed');
    },

    /**
     * Inserts new style object
     * @param {Number} lineIndex Index of a line
     * @param {Number} charIndex Index of a char
     * @param {Boolean} isEndOfLine True if it's end of line
     */
    insertNewlineStyleObject: function(lineIndex, charIndex, isEndOfLine) {

      // shift all line styles by 1 forward
      var clonedStyles = clone(this.styles);
      for (var line in this.styles) {
        var numericLine = parseInt(line, 10);
        if (numericLine >= lineIndex) {
          this.styles[numericLine + 1] = clonedStyles[numericLine];
        }
      }

      if (!this.styles[lineIndex + 1]) {
        this.styles[lineIndex + 1] = { };
      }

      var currentCharStyle = this.styles[lineIndex][charIndex - 1];
      var newLineStyles = { };

      // if there's nothing after cursor,
      // we clone current char style onto the next (otherwise empty) line
      if (isEndOfLine) {
        newLineStyles[0] = clone(currentCharStyle);
        this.styles[lineIndex + 1] = newLineStyles;
      }
      // otherwise we clone styles of all chars
      // after cursor onto the next line, from the beginning
      else {
        for (var index in this.styles[lineIndex]) {
          if (parseInt(index, 10) >= charIndex) {
            newLineStyles[parseInt(index, 10) - charIndex] = this.styles[lineIndex][index];
            // remove lines from the previous line since they're on a new line now
            delete this.styles[lineIndex][index];
          }
        }
        this.styles[lineIndex + 1] = newLineStyles;
      }
    },

    /**
     * Inserts style object for a given line/char index
     * @param {Number} lineIndex Index of a line
     * @param {Number} charIndex Index of a char
     */
    insertCharStyleObject: function(lineIndex, charIndex) {

      var currentLineStyles = this.styles[lineIndex];
      var currentLineStylesCloned = clone(currentLineStyles);

      if (charIndex === 0) {
        charIndex = 1;
      }

      // shift all char styles by 1 forward
      // 0,1,2,3 -> (charIndex=2) -> 0,1,3,4 -> (insert 2) -> 0,1,2,3,4
      for (var index in currentLineStylesCloned) {
        var numericIndex = parseInt(index, 10);
        if (numericIndex >= charIndex) {
          currentLineStyles[numericIndex + 1] = currentLineStylesCloned[numericIndex];
          //delete currentLineStyles[index];
        }
      }
      this.styles[lineIndex][charIndex] = clone(currentLineStyles[charIndex - 1]);
    },

    /**
     * Inserts style object
     * @param {String} _char Character at the location where style is inserted
     * @param {Boolean} isEndOfLine True if it's end of line
     */
    insertStyleObject: function(_char, isEndOfLine) {

      // short-circuit
      if (this.styles && Object.keys(this.styles).length === 0) return;

      var cursorLocation = this.get2DCursorLocation();
      var lineIndex = cursorLocation.lineIndex;
      var charIndex = cursorLocation.charIndex;

      if (!this.styles[lineIndex]) {
        this.styles[lineIndex] = { };
      }

      if (_char === '\n') {
        this.insertNewlineStyleObject(lineIndex, charIndex, isEndOfLine);
      }
      else {
        this.insertCharStyleObject(lineIndex, charIndex);
      }
    },

    /**
     * Removes style object
     * @param {Boolean} isBeginningOfLine True if cursor is at the beginning of line
     * @param {Number} [index] Optional index. When not given, current selectionStart is used.
     */
    removeStyleObject: function(isBeginningOfLine, index) {

      var cursorLocation = this.get2DCursorLocation(index);
      var lineIndex = cursorLocation.lineIndex;
      var charIndex = cursorLocation.charIndex;

      // console.log('removeStyleObject', isBeginningOfLine, lineIndex, charIndex);

      if (isBeginningOfLine) {

        var textLines = this.text.split(this._reNewline);
        var textOnPreviousLine = textLines[lineIndex - 1];
        var newCharIndexOnPrevLine = textOnPreviousLine.length;

        if (!this.styles[lineIndex - 1]) {
          this.styles[lineIndex - 1] = { };
        }

        for (charIndex in this.styles[lineIndex]) {
          this.styles[lineIndex - 1][parseInt(charIndex, 10) + newCharIndexOnPrevLine]
            = this.styles[lineIndex][charIndex];
        }

        // shift all line styles by 1 upward
        var clonedStyles = clone(this.styles);
        for (var line in this.styles) {
          var numericLine = parseInt(line, 10);
          if (numericLine > lineIndex) {
            this.styles[numericLine - 1] = clonedStyles[numericLine];
          }
        }
      }
      else {
        var currentLineStyles = this.styles[lineIndex];

        if (currentLineStyles) {
          var offset = this.selectionStart === this.selectionEnd ? -1 : 0;
          delete currentLineStyles[charIndex + offset];
        }

        var currentLineStylesCloned = clone(currentLineStyles);

        // shift all styles by 1 backwards
        for (var index in currentLineStylesCloned) {
          var numericIndex = parseInt(index, 10);
          if (numericIndex >= charIndex && numericIndex !== 0) {
            currentLineStyles[numericIndex - 1] = currentLineStylesCloned[numericIndex];
            delete currentLineStyles[numericIndex];
          }
        }
      }
    },

    /**
     * Inserts new line
     */
    insertNewline: function() {
      this.insertChar('\n');
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _render: function(ctx) {
      this.callSuper('_render', ctx);
      this.isEditing && this.renderCursorOrSelection(ctx);
      this.ctx = ctx;
    },

    /**
     * Renders cursor or selection (depending on what exists)
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    renderCursorOrSelection: function(ctx) {
      if (!this.active) return;

      var chars = this.text.split(''),
          boundaries;

      if (this.selectionStart === this.selectionEnd) {
        boundaries = this.getCursorBoundaries(ctx, chars, 'cursor');

        // console.log(boundaries.left, boundaries.top);

        this.renderCursor(ctx, boundaries);
      }
      else {
        boundaries = this.getCursorBoundaries(ctx, chars, 'selection');
        this.renderSelection(ctx, chars, boundaries);
      }
    },

    /**
     * Returns 2d representation (lineIndex and charIndex) of cursor (or selection start)
     * @param {Number} [selectionStart] Optional index. When not given, current selectionStart is used.
     */
    get2DCursorLocation: function(selectionStart) {
      if (typeof selectionStart === 'undefined') {
        selectionStart = this.selectionStart;
      }
      var textBeforeCursor = this.text.slice(0, selectionStart);
      var linesBeforeCursor = textBeforeCursor.split(this._reNewline);

      return {
        lineIndex: linesBeforeCursor.length - 1,
        charIndex: linesBeforeCursor[linesBeforeCursor.length - 1].length
      };
    },

    /**
     * Returns fontSize of char at the current cursor
     * @param {Number} lineIndex Line index
     * @param {Number} charIndex Char index
     * @return {Number} Character font size
     */
    getCurrentCharFontSize: function(lineIndex, charIndex) {
      return (
        this.styles[lineIndex] &&
        this.styles[lineIndex][charIndex === 0 ? 0 : (charIndex - 1)] &&
        this.styles[lineIndex][charIndex === 0 ? 0 : (charIndex - 1)].fontSize) || this.fontSize;
    },

    /**
     * Returns color (fill) of char at the current cursor
     * @param {Number} lineIndex Line index
     * @param {Number} charIndex Char index
     * @return {String} Character color (fill)
     */
    getCurrentCharColor: function(lineIndex, charIndex) {
      return (
        this.styles[lineIndex] &&
        this.styles[lineIndex][charIndex === 0 ? 0 : (charIndex - 1)] &&
        this.styles[lineIndex][charIndex === 0 ? 0 : (charIndex - 1)].fill) || this.cursorColor;
    },

    /**
     * Returns fontStyle of char at the current cursor
     * @param {Number} lineIndex Line index
     * @param {Number} charIndex Char index
     * @return {String} Character font style
     */
    getCurrentCharStyle: function(lineIndex, charIndex) {
      return (
        this.styles[lineIndex] &&
        this.styles[lineIndex][charIndex === 0 ? 0 : (charIndex - 1)] &&
        this.styles[lineIndex][charIndex === 0 ? 0 : (charIndex - 1)].fontStyle) || this.fontStyle;
    },

    /**
     * Returns cursor boundaries (left, top, leftOffset, topOffset)
     * @param {CanvasRenderingContext2D} ctx Context to render on
     * @param {Array} chars Array of characters
     */
    getCursorBoundaries: function(ctx, chars, typeOfBoundaries) {

      var cursorLocation = this.get2DCursorLocation();
      var lineIndex = cursorLocation.lineIndex;
      var charIndex = cursorLocation.charIndex;

      // left/top are left/top of entire text box
      // leftOffset/topOffset are offset from that left/top point of a text box
      var left = Math.round(this._getLeftOffset());
      var top = -this.height / 2;

      var leftOffset = 0;
      var topOffset = typeOfBoundaries === 'cursor'
        // selection starts at the very top of the line,
        // whereas cursor starts at the padding created by line height
        ? (this._getHeightOfLine(ctx, 0) - this.getCurrentCharFontSize(lineIndex, charIndex))
        : 0;

      var lineIndex = 0;
      var charIndex = 0;
      var textLines = this.text.split(this._reNewline);

      for (var i = 0; i < this.selectionStart; i++) {
        if (chars[i] === '\n') {
          leftOffset = 0;
          topOffset += this._getHeightOfLine(ctx, lineIndex + (typeOfBoundaries === 'cursor' ? 1 : 0));

          lineIndex++;
          charIndex = 0;
        }
        else {
          leftOffset += this._getWidthOfChar(ctx, chars[i], lineIndex, charIndex);
          charIndex++;
        }

        var widthOfLine = this._getWidthOfLine(ctx, lineIndex, textLines);
        var lineLeftOffset = this._getLineLeftOffset(widthOfLine);
      }

      return {
        left: left,
        top: top,
        leftOffset: leftOffset + (lineLeftOffset || 0),
        topOffset: topOffset
      };
    },

    /**
     * Renders cursor
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    renderCursor: function(ctx, boundaries) {
      ctx.save();

      var cursorLocation = this.get2DCursorLocation();
      var lineIndex = cursorLocation.lineIndex;
      var charIndex = cursorLocation.charIndex;

      ctx.fillStyle = this.getCurrentCharColor(lineIndex, charIndex);
      ctx.globalAlpha = this._currentCursorOpacity;

      var charHeight = this.getCurrentCharFontSize(lineIndex, charIndex);

      // if (this.getCurrentCharStyle(lineIndex, charIndex) === 'italic') {
      //   ctx.transform(
      //     1,
      //     0,
      //     Math.tan(fabric.util.degreesToRadians(-10)),
      //     1,
      //     Math.sin(fabric.util.degreesToRadians(10)) * charHeight,
      //     0);
      // }

      ctx.fillRect(
        boundaries.left + boundaries.leftOffset,
        boundaries.top + boundaries.topOffset,
        this.cursorWidth,
        charHeight);

      ctx.restore();
    },

    /**
     * Renders text selection
     * @param {CanvasRenderingContext2D} ctx Context to render on
     * @param {Array} chars Array of characters
     * @param {Object} boundaries Object with left/top/leftOffset/topOffset
     */
    renderSelection: function(ctx, chars, boundaries) {
      ctx.save();
      ctx.fillStyle = this.selectionColor;

      var cursorLocation = this.get2DCursorLocation();
      var lineIndex = cursorLocation.lineIndex;
      var charIndex = cursorLocation.charIndex;
      var textLines = this.text.split(this._reNewline);
      var origLineIndex = lineIndex;

      for (var i = this.selectionStart; i < this.selectionEnd; i++) {

        if (chars[i] === '\n') {
          boundaries.leftOffset = 0;
          boundaries.topOffset += this._getHeightOfLine(ctx, lineIndex);
          lineIndex++;
          charIndex = 0;
        }
        else if (i !== this.text.length) {

          var charWidth = this._getWidthOfChar(ctx, chars[i], lineIndex, charIndex);
          var lineOffset = this._getLineLeftOffset(this._getWidthOfLine(ctx, lineIndex, textLines)) || 0;

          if (lineIndex === origLineIndex) {
            // only offset the line if we're drawing selection of 2nd, 3rd, etc. line
            lineOffset = 0;
          }

          ctx.fillRect(
            boundaries.left + boundaries.leftOffset + lineOffset,
            boundaries.top + boundaries.topOffset,
            charWidth,
            this._getHeightOfLine(ctx, lineIndex));

          boundaries.leftOffset += charWidth;
          charIndex++;
        }
      }
      ctx.restore();
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     * @param {String} _char
     * @param {Number} lineIndex
     * @param {Number} charIndex
     * @param {Object} [decl]
     */
    _applyCharStylesGetWidth: function(ctx, _char, lineIndex, charIndex, decl) {
      var styleDeclaration = decl || (this.styles[lineIndex] && this.styles[lineIndex][charIndex]);

      if (styleDeclaration) {
        // cloning so that original style object is not polluted with following font declarations
        styleDeclaration = clone(styleDeclaration);
      }
      else {
        styleDeclaration = { };
      }

      var fill = styleDeclaration.fill || this.fill;
      ctx.fillStyle = fill.toLive
        ? fill.toLive(ctx)
        : fill;

      if (styleDeclaration.stroke) {
        ctx.strokeStyle = (styleDeclaration.stroke && styleDeclaration.stroke.toLive)
          ? styleDeclaration.stroke.toLive(ctx)
          : styleDeclaration.stroke;
      }
      ctx.lineWidth = styleDeclaration.strokeWidth || this.strokeWidth;

      if (!styleDeclaration.fontFamily) {
        styleDeclaration.fontFamily = this.fontFamily;
      }
      if (!styleDeclaration.fontSize) {
        styleDeclaration.fontSize = this.fontSize;
      }
      if (!styleDeclaration.fontWeight) {
        styleDeclaration.fontWeight = this.fontWeight;
      }
      if (!styleDeclaration.fontStyle) {
        styleDeclaration.fontStyle = this.fontStyle;
      }
      if (typeof styleDeclaration.shadow == 'string') {
        styleDeclaration.shadow = new fabric.Shadow(styleDeclaration.shadow);
      }

      this._setShadow.call(styleDeclaration, ctx);

      ctx.font = this._getFontDeclaration.call(styleDeclaration);

      return ctx.measureText(_char).width;
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _restoreShadow: function(ctx, lineIndex, charIndex) {
      // if there's shadow, context needs to be restored back after it was saved by shadow logic
      if (this.styles[lineIndex] &&
          this.styles[lineIndex][charIndex] &&
          this.styles[lineIndex][charIndex].shadow) {
        ctx.restore();
      }
    },

    /**
     * @private
     * @param {String} method
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _drawTextLine: function(method, ctx, line, left, top, lineIndex) {
      // console.log('_drawTextLine', method, line);

      // to "cancel" this.fontSize subtraction in fabric.Text#_drawTextLine
      top += this.fontSize / 4;
      this.callSuper('_drawTextLine', method, ctx, line, left, top, lineIndex);
    },

    _drawCharsFast: function(method, ctx, line, left, top) {
      this.skipTextAlign = false;

      if (method === 'fillText' && this.fill) {
        this.callSuper('_drawChars', method, ctx, line, left, top);
      }
      if (method === 'strokeText' && this.stroke) {
        this.callSuper('_drawChars', method, ctx, line, left, top);
      }
    },

    /**
     * @private
     * @param {String} method
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _drawChars: function(method, ctx, line, left, top, lineIndex) {

      // console.log('_drawChars', method);

      if (this.styles && Object.keys(this.styles).length === 0) {
        return this._drawCharsFast(method, ctx, line, left, top);
      }

      this.skipTextAlign = true;

      // set proper box offset
      left -= this.textAlign === 'center'
        ? (this.width / 2)
        : (this.textAlign === 'right')
          ? this.width
          : 0;

      // set proper line offset
      var textLines = this.text.split(this._reNewline);
      var lineWidth = this._getWidthOfLine(ctx, lineIndex, textLines);
      var lineLeftOffset = this._getLineLeftOffset(lineWidth);
      var decl;

      left += lineLeftOffset || 0;

      var chars = line.split('');

      ctx.save();
      for (var i = 0, len = chars.length; i < len; i++) {

        if (this.styles && this.styles[lineIndex] && (decl = this.styles[lineIndex][i])) {

          var shouldStroke = decl.stroke || this.stroke;
          var shouldFill = decl.fill || this.fill;

          ctx.save();
          var charWidth = this._applyCharStylesGetWidth(ctx, chars[i], lineIndex, i, decl);

          if (shouldFill) {
            ctx.fillText(chars[i], left, top);
          }
          if (shouldStroke) {
            ctx.strokeText(chars[i], left, top);
          }

          this._renderCharDecoration(ctx, decl, left, top, charWidth);
          ctx.restore();

          //this._restoreShadow(ctx, lineIndex, i);

          ctx.translate(charWidth, 0);
        }
        else {
          if (method === 'strokeText' && this.stroke) {
            ctx[method](chars[i], left, top);
          }
          if (method === 'fillText' && this.fill) {
            ctx[method](chars[i], left, top);
          }
          ctx.translate(ctx.measureText(chars[i]).width, 0);
        }
      }
      ctx.restore();
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _renderCharDecoration: function(ctx, styleDeclaration, left, top, charWidth) {
      if (!styleDeclaration.textDecoration) return;

      var fontSize = this.fontSize;

      if (styleDeclaration.textDecoration.indexOf('underline') > -1) {
        this._renderCharDecorationAtOffset(
          ctx,
          left,
          top + (fontSize / this._fontSizeFraction),
          charWidth,
          0
        );
      }
      if (styleDeclaration.textDecoration.indexOf('line-through') > -1) {
        this._renderCharDecorationAtOffset(
          ctx,
          left,
          top + (fontSize / this._fontSizeFraction),
          charWidth,
          20
        );
      }
      if (styleDeclaration.textDecoration.indexOf('overline') > -1) {
        this._renderCharDecorationAtOffset(ctx, left, top, charWidth, fontSize);
      }
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _renderCharDecorationAtOffset: function(ctx, left, top, charWidth, offset) {
      ctx.fillRect(left, top - offset, charWidth, 1);
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     * @param {Array} textLines Array of all text lines
     */
    _renderTextLinesBackground: function(ctx, textLines) {
      if (!this.textBackgroundColor && !this.styles) return;

      ctx.save();

      if (this.textBackgroundColor) {
        ctx.fillStyle = this.textBackgroundColor;
      }

      var lineHeights = 0;
      var fractionOfFontSize = this.fontSize / this._fontSizeFraction;

      for (var i = 0, len = textLines.length; i < len; i++) {

        var heightOfLine = this._getHeightOfLine(ctx, i, textLines);
        if (textLines[i] === '') {
          lineHeights += heightOfLine;
          continue;
        }

        var lineWidth = this._getLineWidth(ctx, textLines[i]);
        var lineLeftOffset = this._getLineLeftOffset(lineWidth);

        if (this.textBackgroundColor) {
          ctx.fillStyle = this.textBackgroundColor;

          ctx.fillRect(
            this._getLeftOffset() + lineLeftOffset,
            this._getTopOffset() + lineHeights + fractionOfFontSize,
            lineWidth,
            heightOfLine
          );
        }
        if (this.styles[i]) {
          for (var j = 0, jlen = textLines[i].length; j < jlen; j++) {
            if (this.styles[i] && this.styles[i][j] && this.styles[i][j].textBackgroundColor) {

              var _char = textLines[i][j];

              ctx.fillStyle = this.styles[i][j].textBackgroundColor;

              ctx.fillRect(
                this._getLeftOffset() + lineLeftOffset + this._getWidthOfCharsAt(ctx, i, j, textLines),
                this._getTopOffset() + lineHeights + fractionOfFontSize,
                this._getWidthOfChar(ctx, _char, i, j, textLines) + 1,
                heightOfLine
              );
            }
          }
        }
        lineHeights += heightOfLine;
      }
      ctx.restore();
    },

    /**
     * Returns object representation of an instance
     * @methd toObject
     * @param {Array} [propertiesToInclude] Any properties that you might want to additionally include in the output
     * @return {Object} object representation of an instance
     */
    toObject: function(propertiesToInclude) {
      return fabric.util.object.extend(this.callSuper('toObject', propertiesToInclude), {
        styles: clone(this.styles)
      });
    },

    /* _TO_SVG_START_ */
    /**
     * Returns SVG representation of an instance
     * @return {String} svg representation of an instance
     */
    toSVG: function() {
      // TODO:
    },
    /* _TO_SVG_END_ */

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getWidthOfChar: function(ctx, _char, lineIndex, charIndex) {
      ctx.save();
      var width = this._applyCharStylesGetWidth(ctx, _char, lineIndex, charIndex);
      //this._restoreShadow(ctx, lineIndex, charIndex);
      ctx.restore();
      return width;
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getHeightOfChar: function(ctx, _char, lineIndex, charIndex) {
      if (this.styles[lineIndex] && this.styles[lineIndex][charIndex]) {
        return this.styles[lineIndex][charIndex].fontSize || this.fontSize;
      }
      return this.fontSize;
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getWidthOfCharAt: function(ctx, lineIndex, charIndex, lines) {
      lines = lines || this.text.split(this._reNewline);
      var _char = lines[lineIndex].split('')[charIndex];
      return this._getWidthOfChar(ctx, _char, lineIndex, charIndex);
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getHeightOfCharAt: function(ctx, lineIndex, charIndex, lines) {
      lines = lines || this.text.split(this._reNewline);
      var _char = lines[lineIndex].split('')[charIndex];
      return this._getHeightOfChar(ctx, _char, lineIndex, charIndex);
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getWidthOfCharsAt: function(ctx, lineIndex, charIndex, lines) {
      var width = 0;
      for (var i = 0; i < charIndex; i++) {
        width += this._getWidthOfCharAt(ctx, lineIndex, i, lines);
      }
      return width;
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getWidthOfLine: function(ctx, lineIndex, textLines) {
      // if (!this.styles[lineIndex]) {
      //   return this.callSuper('_getLineWidth', ctx, textLines[lineIndex]);
      // }
      return this._getWidthOfCharsAt(ctx, lineIndex, textLines[lineIndex].length, textLines);
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getTextWidth: function(ctx, textLines) {

      if (!this.styles) {
        return this.callSuper('_getTextWidth', ctx, textLines);
      }

      var maxWidth = this._getWidthOfLine(ctx, 0, textLines);

      for (var i = 1, len = textLines.length; i < len; i++) {
        var currentLineWidth = this._getWidthOfLine(ctx, i, textLines);
        if (currentLineWidth > maxWidth) {
          maxWidth = currentLineWidth;
        }
      }
      return maxWidth;
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getHeightOfLine: function(ctx, lineIndex, textLines) {

      textLines = textLines || this.text.split(this._reNewline);

      var maxHeight = this._getHeightOfChar(ctx, textLines[lineIndex][0], lineIndex, 0);

      var line = textLines[lineIndex];
      var chars = line.split('');

      for (var i = 1, len = chars.length; i < len; i++) {
        var currentCharHeight = this._getHeightOfChar(ctx, chars[i], lineIndex, i);
        if (currentCharHeight > maxHeight) {
          maxHeight = currentCharHeight;
        }
      }

      return maxHeight * this.lineHeight;
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getTextHeight: function(ctx, textLines) {
      var height = 0;
      for (var i = 0, len = textLines.length; i < len; i++) {
        height += this._getHeightOfLine(ctx, i, textLines);
      }
      return height;
    },

    /**
     * @private
     * @param {CanvasRenderingContext2D} ctx Context to render on
     */
    _getTopOffset: function() {
      var topOffset = fabric.Text.prototype._getTopOffset.call(this);
      return topOffset - (this.fontSize / this._fontSizeFraction);
    }
  });

  /**
   * Returns fabric.IText instance from an object representation
   * @static
   * @memberOf fabric.IText
   * @param {Object} object Object to create an instance from
   * @return {fabric.IText} instance of fabric.IText
   */
  fabric.IText.fromObject = function(object) {
    return new fabric.IText(object.text, clone(object));
  };

})();
