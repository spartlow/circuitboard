/* Simple JavaScript Inheritance
 * By John Resig http://ejohn.org/
 * MIT Licensed.
 */
// Inspired by base2 and Prototype
// TODO: Add bus type for wire. Perhaps need to change data to be integer versus boolean everywhere?
(function () {
  var initializing = false, fnTest = /xyz/.test(function () { xyz; }) ? /\b_super\b/ : /.*/;
  // The base Class implementation (does nothing)
  this.Class = function () { };

  // Create a new Class that inherits from this class
  Class.extend = function (prop) {
    var _super = this.prototype;

    // Instantiate a base class (but only create the instance,
    // don't run the init constructor)
    initializing = true;
    var prototype = new this();
    initializing = false;

    // Copy the properties over onto the new prototype
    for (var name in prop) {
      // Check if we're overwriting an existing function
      prototype[name] = typeof prop[name] == "function" &&
        typeof _super[name] == "function" && fnTest.test(prop[name]) ?
        (function (name, fn) {
          return function () {
            var tmp = this._super;

            // Add a new ._super() method that is the same method
            // but on the super-class
            this._super = _super[name];

            // The method only need to be bound temporarily, so we
            // remove it when we're done executing
            var ret = fn.apply(this, arguments);
            this._super = tmp;

            return ret;
          };
        })(name, prop[name]) :
        prop[name];
    }

    // The dummy class constructor
    function Class() {
      // All construction is actually done in the init method
      if (!initializing && this.init)
        this.init.apply(this, arguments);
    }

    // Populate our constructed prototype object
    Class.prototype = prototype;

    // Enforce the constructor to be what we expect
    Class.prototype.constructor = Class;

    // And make this class extendable
    Class.extend = arguments.callee;

    return Class;
  };
})();

var ON_COLOR = '#51C2C6';
//var ON_COLOR = '#F00';
var ON_BACKGROUND = ON_COLOR;
//var ON_BACKGROUND = '#F66';
//var SELECT_COLOR = '#337777';
//var SELECT_COLOR = '#DDDD55';
var SELECT_COLOR = '#000000';
//var SELECT_BACKGROUND = '#DDDD22';
var SELECT_BACKGROUND = '#0009';
const SCALE_FACTOR = 2;
// See https://www.canva.com/colors/color-wheel/
var drawingBoardManager;
function buildDrawingBoards() {
  if (!isCanvasSupported()) return; // do nothing if canvas isn't supported.
  var mgr = new DrawingBoardManager();
  var nodes = document.getElementsByClassName('drawingBoard');
  for (var i = 0; i < nodes.length; i++) {
    mgr.addBoard(nodes[i]);
  }
  drawingBoardManager = mgr; // make global
}
function DrawingBoardManager() {
  this.boards = [];
  this.addBoard = function (node) {
    var newBoard = new DrawingBoard(node);
    this.boards.push(newBoard);
    newBoard.draw();
  };
}
function getMousePos(canvas, evt) {
  var rect = canvas.getBoundingClientRect();
  return {
    x: evt.clientX - rect.left,
    y: evt.clientY - rect.top
  };
}
/***********************************************
 * DrawingBoard - logic board function
 * By Steve Partlow
 * TODO: change import to add source/targets instead of replacing inputs/outputs
 * TODO: Add save/load
 * TODO: Add multiple select (CNTL and select box)
 ***********************************************/
/*
About units:
There are several coordinate unit types in this file. They need some simplifying/clarifying/elimination.
 1. Pixel: These are what we get from mouse events as well as canvas.width and .height.
    Position 0,0 is top left of the board.
 2. Canvas units: These are the units used for drawing.
    Likewise, 0,0 is on the top left of the board.
    With scale=1 it's the same as pixel units, but with scale=2 canvas 10,10 is at pixels 20,20.
 3. Board units: These are always 10 * canvas units (as long as board.unit stays at 10).
    Components are located by these units, such that location 1,1 is really at canvas 10,10.
    These are the units in the save file.
 4. Normalized coordinates (aka offset): These are percentages relative to the given component.
    So if a component is a square at 100,100 to 200,200. Then normalized 0,0 is 100,100; 1,1 is 200,200; and .5,.5 is 150,150.
*/
function DrawingBoard(node) {
  var board = this; // needed for scoping
  this.version = 0.5;
  this.unit = 10; // TODO remove board.unit. Or make it just mean where points can snap?
  this.scale = 1;
  this.translation = new Point(0,0);
  this.delay = 100;
  this.node = node;
  this.idPrefix = 'id';
  node.innerHTML = ''; // we don't allow anything in there.
  node.style.position = 'relative';
  node.classList.add('board-container');

  // Set initial size if not already defined
  if (node.clientWidth == 0) node.style.width = '200px';
  if (node.clientHeight == 0) node.style.height = '100px';

  this.canvases = [];
  for (var i = 0; i < 4; i++) {
    var newCanvas = document.createElement('canvas');
    newCanvas.setAttribute('style', 'z-index: ' + (i + 1) + '; position: absolute; top: 0; left: 0;');
    newCanvas.classList.add('board-canvas','board-canvas-' + i);
    node.appendChild(newCanvas);
    this.canvases.push(newCanvas);
  }

  // Resize canvases to fit the parent node
  this.resizeCanvases = function () {
    var oldCenter = this.getPointFromNormalizedCoords(.5, .5);
    const width = node.clientWidth;
    const height = node.clientHeight;

    for (var i = 0; i < this.canvases.length; i++) {
      this.canvases[i].width = width;
      this.canvases[i].height = height;
    }
    this.centerCanvasOn(oldCenter);

    // Redraw the board after resizing
    this.drewGrid = false; // need to draw the grid again
    this.draw();
  };

  // Attach resize event listener
  window.addEventListener('resize', this.resizeCanvases.bind(this));

  this.selected = null;
  this.dragging = null;
  this.components = [];
  this.contexts = [];
  for (i in this.canvases) {
    this.contexts.push(this.canvases[i].getContext("2d"));
  }
  this.set = function (att, val) {
    this[att] = val;
    return this;
  };
  this.get = function (att) {
    return this[att];
  };
  /* Translate canvas coordinate to pixels, taking into account the scaling */
  this.canvasUnitToPixel = function(cu) {
    return cu * this.scale;
  };
  /* Translate pixels to canvas coordinate unit, taking into account the scaling */
  this.pixelToCanvasUnit = function(px) {
    return px / this.scale;
  };
  /* Translate x/y coordinate from pixels to canvas coordinate unit, taking into account the scaling */
  this.pixelCoordToCanvasCoord = function(pixelPoint) {
    //newCoord = {x: this.pixelToCanvasUnit(c.x), y: this.pixelToCanvasUnit(c.y)};
    //return newCoord;
    //const rect = canvas.getBoundingClientRect();
    //const x = event.clientX - rect.left;
    //const y = event.clientY - rect.top;
    ctx = this.contexts[0];
    const transform = ctx.getTransform();
    const invTransform = transform.inverse();
    var point = new Point(
      Math.round(invTransform.e + (pixelPoint.x * invTransform.a) + (pixelPoint.y * invTransform.c)),
      Math.round(invTransform.f + (pixelPoint.x * invTransform.b) + (pixelPoint.y * invTransform.d))
    );
    return point;
  };
  this.drawGrid = function () {
    this.drewGrid = true;
    var topLeft = this.pixelCoordToCanvasCoord(new Point(0, 0));
    var botRight = this.pixelCoordToCanvasCoord(new Point(this.canvases[0].width, this.canvases[0].height));
    var left = topLeft.x;
    var top = topLeft.y;
    var right = botRight.x;
    var bottom = botRight.y;
    this.contexts[0].clearRect(left, top, right - left, bottom - top);
    if (this.noGrid) return;
    var increment = this.unit;
    this.contexts[0].lineWidth = .5;
    this.contexts[0].beginPath();
    this.contexts[0].strokeStyle = '#EEE';
    for (var x = Math.floor(left / increment) * increment; x < right; x += increment) {
      this.contexts[0].moveTo(x, top);
      this.contexts[0].lineTo(x, bottom);
    }
    for (var y = Math.floor(top / increment) * increment; y < bottom; y += increment) {
      this.contexts[0].moveTo(left, y);
      this.contexts[0].lineTo(right, y);
    }
    this.contexts[0].stroke();
    this.contexts[0].closePath();

    /* Now draw major lines */
    var increment = this.unit * 10;
    this.contexts[0].lineWidth = 1;
    this.contexts[0].beginPath();
    this.contexts[0].strokeStyle = '#CCC';
    for (var x = Math.floor(left / increment) * increment; x < right; x += increment) {
      this.contexts[0].moveTo(x, top);
      this.contexts[0].lineTo(x, bottom);
    }
    for (var y = Math.floor(top / increment) * increment; y < bottom; y += increment) {
      this.contexts[0].moveTo(left, y);
      this.contexts[0].lineTo(right, y);
    }
    this.contexts[0].stroke();
    this.contexts[0].closePath();

    /* Now draw major major lines */
    var increment = this.unit * 100;
    this.contexts[0].lineWidth = 2;
    this.contexts[0].beginPath();
    this.contexts[0].strokeStyle = '#AAA';
    this.contexts[0].stroke();
    this.contexts[0].closePath();
    for (var x = Math.floor(left / increment) * increment; x < right; x += increment) {
      this.contexts[0].moveTo(x, top);
      this.contexts[0].lineTo(x, bottom);
    }
    for (var y = Math.floor(top / increment) * increment; y < bottom; y += increment) {
      this.contexts[0].moveTo(left, y);
      this.contexts[0].lineTo(right, y);
    }
    this.contexts[0].stroke();
    this.contexts[0].closePath();
  };
  this.addComponent = function (component) {
    this.components.push(component);
    component.id = this.idPrefix + this.components.length + '_' + (new Date().getTime());
    return component;
  }
  this.removeComponent = function (component) {
    if (!component.deleted) throw "Must delete component";
    if (this.selected == component) this.unselect();
    if (this.dragging == component) this.stopDragging();
    removeElementFromArray(this.components, component);
  }
  this.getCanvasBoundingRect = function getCanvasBoundingRectfunction() {
    var topLeft = this.pixelCoordToCanvasCoord(new Point(0, 0));
    var botRight = this.pixelCoordToCanvasCoord(new Point(this.canvases[0].width, this.canvases[0].height));
    var rect = new Rectangle(topLeft, botRight);
    return rect;
  };
  this.getPointFromNormalizedCoords = function getPointFromNormalizedCoords(xPct, yPct) {
    var topLeft = this.pixelCoordToCanvasCoord(new Point(0, 0));
    var botRight = this.pixelCoordToCanvasCoord(new Point(this.canvases[0].width, this.canvases[0].height));
    var x = Math.round(topLeft.x + (botRight.x - topLeft.x) * xPct);
    var y = Math.round(topLeft.y + (botRight.y - topLeft.y) * yPct);
    return new Point(x, y);
  };
  this.getDesignBoundingRect = function () {
    var rect = null;
    for (var i in this.components) {
      var compRect = this.components[i].getBoundingRect();
      if (compRect == null) continue;
      if (rect == null) rect = compRect;
      else {
        if (compRect.top < rect.top) rect.top = compRect.top;
        if (compRect.left < rect.left) rect.left = compRect.left;
        if (compRect.right > rect.right) rect.right = compRect.right;
        if (compRect.bottom > rect.bottom) rect.bottom = compRect.bottom;
      }
    }
    return rect;
  };
  this.resetTransforms = function resetTransforms() {
    for (i in this.contexts) {
      this.contexts[i].resetTransform();
    }
    this.scale = 1;
    this.translation = new Point(0,0);
    this.drewGrid = false;
  };
  this.centerCanvasOn = function centerCanvasOn(center) {
    var canvasCenter = this.getPointFromNormalizedCoords(.5, .5);
    var translation = new Point(
      Math.round(this.translation.x + canvasCenter.x - center.x),
      Math.round(this.translation.y + canvasCenter.y - center.y)
    );
    this.setTranslation(translation); // This will cause a the canvases to draw
  };
  this.centerDesign = function centerDesign() {
    var designRect = this.getDesignBoundingRect();
    if (designRect === null) {
      var designCenter = new Point(0, 0);
    } else {
      var designCenter = designRect.getPointFromNormalizedCoords(.5, .5);
    }
    this.centerCanvasOn(designCenter);
  };
  this.transformToFit = function transformToFit() {
    // Get back to no transform (easier to set scale later)
    this.resetTransforms();
    var designRect = this.getDesignBoundingRect();
    if (designRect !== null) {
      var canvasRect = this.getCanvasBoundingRect();
      var scale = Math.min(
        (canvasRect.getWidth() / designRect.getWidth()),
        (canvasRect.getHeight() / designRect.getHeight())
      );
      console.log(scale);
      // This should use SCALE_FACTOR but it's hard-coded to 2 to use log2
      scale = Math.pow(2, Math.floor(Math.log2(scale))); // Round down to power of 2
      scale = Math.min(1, scale);
      scale = Math.max(0.1, scale);
      this.scale = scale;
      this.commitTransforms();
    }
    this.centerDesign();
    this.draw();
    return;
  };
  this.draw = function () {
    var topLeft = this.pixelCoordToCanvasCoord(new Point(0, 0));
    var botRight = this.pixelCoordToCanvasCoord(new Point(this.canvases[0].width, this.canvases[0].height));
    if (!this.drewGrid) this.drawGrid();
    for (i in this.contexts) {
      if (i != 0) this.contexts[i].clearRect(topLeft.x, topLeft.y, botRight.x - topLeft.x, botRight.y - topLeft.y);
    }
    for (i in this.components) {
      if (this.components[i].isWire) {
        this.components[i].draw(this.contexts[1]);
      } else if (this.components[i].isConnection) {
        this.components[i].draw(this.contexts[3]);
      } else {
        this.components[i].draw(this.contexts[2]);
      }
    }
    if (this.buildingWire && this.pointerCoords != null) {
      var from = {};
      var to = {};
      if (this.buildingWireConnection == null) {
        from.x = this.pointerCoords.x + 30; //this.canvases[0].width / this.scale;
        from.y = this.pointerCoords.y - 10; //0;
      } else {
        from.x = this.buildingWireConnection.x;
        from.y = this.buildingWireConnection.y;
      }
      if (this.selected == null) {
        to.x = this.pointerCoords.x;
        to.y = this.pointerCoords.y;
      } else {
        to.x = this.selected.x;
        to.y = this.selected.y;
      }
      var cxt = this.contexts[1]; // use wire context
      cxt.save();
      cxt.beginPath();
      cxt.lineWidth = 1;
      if (this.data > 0) {
        cxt.strokeStyle = ON_COLOR;
      } else {
        cxt.strokeStyle = '#000';
      }
      cxt.shadowBlur = 5;
      cxt.shadowColor = SELECT_BACKGROUND;
      cxt.shadowOffsetX = 5;
      cxt.shadowOffsetY = 5;
      cxt.moveTo(from.x, from.y);
      cxt.lineTo(to.x, to.y);
      cxt.stroke();
      cxt.closePath();
      cxt.restore();
    }
  }
  this.select = function (component) {
    this.unselect();
    this.selected = component;
    component.selected = true;
    if (this.componentMenu) this.componentMenu.update();
  };
  this.unselect = function () {
    if (this.selected !== null) {
      this.selected.selected = false;
      this.selected = null;
    }
    if (this.componentMenu) this.componentMenu.update();
  };
  this.startDragging = function (component, coords) {
    if (component.isDraggable !== false) {
      board.dragging = component;
      component.beingDragged = true;
      board.draggedFromXDelta = coords.x - component.x;
      board.draggedFromYDelta = coords.y - component.y;
    }
  }
  this.stopDragging = function () {
    if (board.dragging !== null) {
      board.dragging.beingDragged = false;
      board.dragging = null;
    }
  }
  this.getImportComponentById = function (id) {
    for (var i = 0; i < this.importedBoard.components.length; i++) {
      if (this.importedBoard.components[i].id == id) {
        return this.importedBoard.components[i];
      }
    }
    return null;
  };
  this.createMenu = function (args) {
    this.menu = new drawingBoardMenu(this, args);
    /* Next shrink the canvases to make room */
    for (var i = 0; i < this.canvases.length; i++) {
      //this.canvases[i].setAttribute('height', this.node.clientHeight - this.menu.node.clientHeight);
      //this.canvases[i].style.top = '' + this.menu.node.clientHeight + 'px';
    }
  };
  this.createPartsMenu = function () {
    this.partsMenu = new partsMenu(this);
    this.componentMenu = new ComponentMenu(this, this.node);
    /* Next shrink the canvases to make room */
    for (var i = 0; i < this.canvases.length; i++) {
      //this.canvases[i].setAttribute('width', this.node.clientWidth - this.partsMenu.node.clientWidth);
      //this.canvases[i].style.top = ''+this.partsMenu.node.clientHeight+'px';
    }
  };
  this.commitTransforms = function () {
    for (i in this.contexts) {
      this.contexts[i].resetTransform();
      this.contexts[i].scale(this.scale, this.scale)
      this.contexts[i].translate(this.translation.x, this.translation.y)
    }
    this.drewGrid = false; // need to draw the grid again
    // Caller needs to ensure this.draw is called
  };
  this.setScale = function (s) {
    this.scale = s;
    this.commitTransforms();
    this.draw();
    return this;
  };
  this.setTranslation = function(x, y) {
    if (y == null) {var point = x}
    else {point = new Point(x,y)}
    this.translation = point;
    this.commitTransforms();
    this.draw();
    return this;
  };
  this.setUnit = function (unit) {
    var oldUnit = this.unit;
    this.unit = unit;
    if (oldUnit != this.unit) {
      for (var i = 0; i < this.components.length; i++) {
        comp = this.components[i];
        if (comp.parent == null) { // child components will be updated by their parents
          if (comp.height) comp.setHeight(comp.height / oldUnit);
          if (comp.width) comp.setWidth(comp.width / oldUnit);
          comp.setLocation(comp.x / oldUnit, comp.y / oldUnit);
        }
      }
    }
    this.drewGrid = false; // need to draw the grid again
    this.draw();
    return this;
  };
  this.listener = function (e) {
    e.stopPropagation();
    var mouseCoords = getMousePos(board.canvases[board.canvases.length - 1], e);
    var coords = board.pixelCoordToCanvasCoord(mouseCoords);
    board.pointerCoords = coords;
    var toolTip = document.getElementById("drawingBoardHoverText");
    if (toolTip == null) toolTip = {};
    toolTip.innerHTML = '' + Math.round(coords.x / board.unit) + ',' + Math.round(coords.y / board.unit);
    toolTip.innerHTML += ' (c=' + Math.round(coords.x) + ',' + Math.round(coords.y);
    toolTip.innerHTML += ', p=' + Math.round(mouseCoords.x) + ',' + Math.round(mouseCoords.y) + ')';
    if (board.buildingWire) {
      var comp = board.findClosestConnection(coords, 20, function (candidate) {
        var newIn = candidate.acceptingSources();
        var newOut = candidate.acceptingTargets();
        if (board.buildingWireConnection) {
          if (board.buildingWireConnection.getTopParent() == candidate.getTopParent()) return false;
          var oldIn = board.buildingWireConnection.acceptingSources();
          var oldOut = board.buildingWireConnection.acceptingTargets();
          if ((oldIn && newOut) || (oldOut && newIn)) return true;
          else return false;
        } else {
          if (newIn || newOut) return true;
          else return false;
        }
      });
      if (comp) {
        board.select(comp);
      } else {
        board.unselect();
      }
    }
    if (e.type == 'mousedown') board.unselect();
    if (e.type == 'mouseup') {
      board.stopDragging();
      if (board.buildingWire) {
        if (board.selected) {
          if (board.buildingWireConnection) {
            if (board.selected.acceptingSources() && board.buildingWireConnection.acceptingTargets()) {
              var from = board.buildingWireConnection;
              var to = board.selected;
            } else if (board.selected.acceptingTargets() && board.buildingWireConnection.acceptingSources()) {
              var from = board.selected;
              var to = board.buildingWireConnection;
            } else throw "Can't build wire here!";
            new Wire(board).addSource(from).addTarget(to);
            board.buildingWireConnection = null; // build a new wire
          } else {
            board.buildingWireConnection = board.selected;
          }
        } else {
          // clicked somewhere else, stop building??? create connection???
        }
      }
    }
    if (e.type == 'mousemove') {
      if (board.dragging) {
        board.dragging.setLocation( // Snap to board units
          Math.floor((coords.x - board.draggedFromXDelta) / board.unit)
          , Math.floor((coords.y - board.draggedFromYDelta) / board.unit)
        );
      }
    }
    if (e.type == 'mouseout') {
      board.pointerCoords = null;
    }
    for (i in board.components) {
      var comp = board.components[i];
      if (comp.containsPoint(coords.x, coords.y)) {
        toolTip.innerHTML += ' in ' + comp.className + ' id=' + comp.id + ' data=' + comp.data;
        if (e.type == 'mousedown') {
          comp = comp.getTopParent(); // get top component
          if (comp.onClick) {
            comp.onClick(e, coords);
          }
          if (!board.noSelecting) {
            board.select(comp);
          }
          if (!board.noDragging) {
            board.startDragging(comp, coords);
          }
        }
        break; // don't bother processing another component
      }
    }
    if (board.selected) toolTip.innerHTML += '<br/>selected=' + board.selected.className + ' ' + board.selected.name + ' ' + board.selected.getRotation();
    if (board.dragging) toolTip.innerHTML += '<br/>dragging=' + board.dragging.className + ' ' + board.dragging.name;
    board.draw();
  };
  this.toJSON = function () {
    //return this.export();
    var me = {};
    me.components = [];
    for (x in this) {
      switch (x) {
        case 'components':
          for (var i = 0; i < this.components.length; i++) {
            var comp = this.components[i];
            //if (comp.isConnection) continue; // Need at least for waypoints
            me.components.push(comp);
          }
          break;
        default:
          me[x] = this[x];
      }
    }
    delete me.canvases;
    delete me.contexts;
    delete me.node;
    delete me.menu;
    delete me.partsMenu;
    delete me.componentMenu;
    delete me.drewGrid;
    delete me.selected;
    delete me.dragging;
    delete me.buildingWire;
    delete me.buildingWireComponent;
    delete me.draggedFromXDelta;
    delete me.draggedFromYDelta;
    delete me.pointerCoords;
    delete me.translation;
    return me;
  },
  this.clear = function() {
    this.components = [];
  };
  this.export = function () {
    var obj = {};
    obj.type = "DrawingBoard";
    obj.version = this.version;
    obj.scale = this.scale;
    obj.delay = this.delay;
    obj.components = [];
    for (var i = 0; i < this.components.length; i++) {
      var compObj = this.components[i].export();
      if (compObj) obj.components.push(compObj);
    }
    return JSON.stringify(obj, null, null);
  }
  this.import = function (json) { // import DrawingBoard
    if (json.constructor.name === "Object") json = JSON.stringify(json); // serialize to get a copy
    var obj = JSON.parse(json);
    this.importedBoard = obj;
    if (obj.scale) this.scale = obj.scale;
    else this.scale = 1;
    this.delay = obj.delay;
    this.components = []; // TBD do we really want to erase what's already here???
    for (var i = 0; i < obj.components.length; i++) {
      var comp = new window[obj.components[i].className](this);
      comp.id = obj.components[i].id; // use the old ID
      //obj.components[i].importTarget = comp; // just creating it already added to the components list
      obj.components[i].targetComp = comp; // save for later
      comp.importedObj = obj.components[i]; // save for debug
    }
    /*
     * Import setting of each non-wire component now that they all exist
     */
    for (var i = 0; i < obj.components.length; i++) {
      compObj = obj.components[i];
      if (compObj.targetComp && compObj.targetComp.className != "Wire") {
        comp = compObj.targetComp;
        comp.import(compObj);
        //delete comp.importedObj; // no longer needed
        comp.imported = true;
      } else if (comp.imported != true) {
        throw "non-imported component found";
      }
    }
    /*
     * Now connect the wires.
     */
    for (var i = 0; i < obj.components.length; i++) {
      compObj = obj.components[i];
      if (compObj.targetComp && compObj.targetComp.className == "Wire") {
        comp = compObj.targetComp;
        comp.import(compObj);
        //delete comp.importedObj; // no longer needed
        comp.imported = true;
      } else if (comp.imported != true) {
        throw "non-imported component found";
      }
    }
    this.drewGrid = false; // Redraw the grid
    this.draw();
  }
  this.findClosestConnection = function (coord, maxDistance, isMatch) {
    if (isMatch == null) isMatch = function (comp) { return true };
    var closest = null;
    var minDistance = 0;
    for (var i = 0; i < this.components.length; i++) {
      var comp = this.components[i];
      if (!comp.isConnection) continue;
      var distance = lineDistance(coord, comp);
      if ((maxDistance == null || distance <= maxDistance) && (closest == null || distance < minDistance) && isMatch(comp)) {
        closest = comp;
        minDistance = distance;
      }
    }
    return closest;
  }
  this.boardUnitCoordsToPixels = function (coords) {
    return {"x": coords.x * this.unit, "y": coords.y * this.unit};
  }
  this.canvases[this.canvases.length - 1].addEventListener("mousemove", this.listener);
  this.canvases[this.canvases.length - 1].addEventListener("mousedown", this.listener);
  this.canvases[this.canvases.length - 1].addEventListener("mouseup", this.listener);
  this.canvases[this.canvases.length - 1].addEventListener("mouseout", this.listener);
  if (node.getAttribute('data-board-setup')) {
    var setup = window[node.getAttribute('data-board-setup')];
    if (setup) {
      setup(this);
    }
  }
  // Initial resize to fit the current viewport
  this.resizeCanvases();
  this.transformToFit();
  //this.setTranslation(new Point(155,155));
}

/***********************************************
 * drawingBoardMenu
 * Creates and controls menu for drawing board
 ***********************************************/
function drawingBoardMenu(board, args) {
  this.addButton = function (content, action) {
    var button = document.createElement('div');
    //button.setAttribute('style', 'display: inline-block; height: 20px; border: solid 1px; margin: 1px;');
    button.classList.add('board-button');
    button.innerHTML = content;
    button.onclick = action;
    this.node.appendChild(button);
  }
  this.node = document.createElement('div');
  this.node.setAttribute('style', `z-index: 100; position: absolute; top: 2px; left: 2px; display: inline-block;`);
  this.node.classList.add('board-menu', 'board-main-menu');
  this.node.innerHTML = 'Menu:';

  // Add buttons to the menu
  if (args && args['saveFunc']) {
      this.addButton('Save', function () {
        try {
            const json = board.export();
            args['saveFunc'](json);
        } catch (error) {
            console.error("Error saving board:", error);
        }
    });
  }
  if (args && args['loadFunc']) {
      this.addButton('Load', function () {
        try {
            args['loadFunc']();
        } catch (error) {
            console.error("Error loading board:", error);
        }
    });
  }

  this.addButton('Export', function () {
      try {
          const json = board.export();
          const jsonArea = document.getElementById('jsonArea');
          jsonArea.innerHTML = json;
      } catch (error) {
          console.error("Error exporting board:", error);
      }
  });

  this.addButton('Import', function (e) {
      e.preventDefault();
      const inputData = window.prompt("Paste import data", '{}');
      if (inputData) {
          try {
              board.import(inputData);
          } catch (error) {
              console.error("Error importing data:", error);
          }
      }
  });

  this.addButton('Copy', function (e) {
    e.preventDefault();
    try {
          copiedData = JSON.stringify(board);
      } catch (error) {
          console.error("Error copying board data:", error);
      }
  });

  this.addButton('Paste', function (e) {
    e.preventDefault();
    if (copiedData) {
          try {
              board.import(copiedData);
          } catch (error) {
              console.error("Error pasting board data:", error);
          }
      } else {
          console.warn("No data to paste.");
      }
  });
/* Not sure what this is supposed to do, but it doesn't work.
  this.addButton('Print', function (e) {
      e.preventDefault();
      const jsonArea = document.getElementById('jsonArea');
      if (jsonArea) {
          jsonArea.innerHTML = copiedData || "No data to print.";
      } else {
          console.error("Element with ID 'jsonArea' not found.");
      }
  });
*/
this.addButton('Recenter', function (e) {
  e.preventDefault();
  board.transformToFit();
});
this.addButton('-', function (e) {
    e.preventDefault();
    var oldCenter = board.getPointFromNormalizedCoords(.5, .5);
    const newScale = board.scale / SCALE_FACTOR;
    if (newScale >= 0.1) {
      board.setScale(newScale);
      board.centerCanvasOn(oldCenter);
    }
});

this.addButton('+', function (e) {
    e.preventDefault();
    var oldCenter = board.getPointFromNormalizedCoords(.5, .5);
    const newScale = board.scale * SCALE_FACTOR;
    if (newScale <= 10) {
      board.setScale(newScale);
      board.centerCanvasOn(oldCenter);
    }
});


  board.node.appendChild(this.node);
}
/***********************************************
 * partsMenu
 ***********************************************/
function partsMenu(board) {
  this.addButton = function (content, action) {
    var menu = this;
    var button = {};
    button.node = document.createElement('div');
    button.active = false;
    //button.node.setAttribute('style', 'display: inline-block; height: 20px; border: solid 1px; margin: 1px;');
    button.node.classList.add('board-button');
      button.node.innerHTML = content;
    button.activate = function () {
      if (menu.activeButton != null && menu.activeButton != this) {
        menu.activeButton.deactivate(); // deactivate other button
      }
      menu.activeButton = this;
      this.active = true;
      //this.node.setAttribute('style', 'display: inline-block; height: 20px; border: solid 1px; margin: 1px; background-color: yellow;');
      button.node.classList.add('board-button-active');
    }
    button.deactivate = function () {
      this.active = false;
      //this.node.setAttribute('style', 'display: inline-block; height: 20px; border: solid 1px; margin: 1px;');
      button.node.classList.remove('board-button-active');
    }
    button.toggleActive = function () {
      if (this.active) this.deactivate();
      else this.activate();
    }
    button.node.onclick = function (e) {
      if (menu.activeButton != null && menu.activeButton != button) {
        menu.activeButton.deactivate(); // deactivate other button
      }
      board.buildingWire = false; // default to turning off
      action.call(button, e);
    }
    this.node.appendChild(button.node);
  }
  this.node = document.createElement('div');
  this.node.setAttribute('style', 'z-index: 100; position: absolute; top: 2px; right: 1px; display: inline-block;');
  this.node.classList.add('board-menu', 'board-parts-menu');
  this.node.innerHTML = 'Parts:';
  this.addButton('Wire', function (e, origBuildingWire) {
    this.toggleActive();
    board.buildingWire = this.active;
    board.buildingWireConnection = null;
  });
  this.addButton('Source', function (e) {
    var comp = new Source(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('Display', function (e) {
    var comp = new Display(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('Digital Display', function (e) {
    var comp = new Display(board).setLocation(2, 2).set('displayType', 'Digital').setMaxDigits(3);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('NOT', function (e) {
    var comp = new NotGate(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('AND', function (e) {
    var comp = new AndGate(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('OR', function (e) {
    var comp = new OrGate(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('NOR', function (e) {
    var comp = new NorGate(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('NAND', function (e) {
    var comp = new NandGate(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('XOR', function (e) {
    var comp = new XorGate(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('Adder', function (e) {
    var comp = new FullAdder(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('MUX2', function (e) {
    var comp = new MuxGate(board).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('MUX4', function (e) {
    var comp = new MuxGate(board).setNumInputs(4).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  this.addButton('MUX8', function (e) {
    var comp = new MuxGate(board).setNumInputs(8).setLocation(2, 2);
    board.select(comp);
    board.startDragging(comp, { x: comp.x, y: comp.y });
    board.draw();
  });
  board.node.appendChild(this.node);
}
/***********************************************
 * ComponentMenu
 ***********************************************/
var ComponentMenu = function (board, parentNode) {
  this.addButton = function (content, action) {
    var button = {};
    button.node = document.createElement('div');
    button.menu = this;
    //button.node.setAttribute('style', 'display: inline-block; height: 20px; border: solid 1px; margin: 1px;');
    button.node.classList.add('board-button');
    button.node.innerHTML = content;
    button.node.onclick = function (e) {
      action.call(button, e);
    }
    this.node.appendChild(button.node);
  }
  this.node = document.createElement('div');
  this.node.setAttribute('style', 'z-index: 100; position: absolute; top: 200px; right: 1px; display: inline-block;');
  this.node.classList.add('board-menu', 'board-component-menu');
  this.component = null;
  this.update = function () {
    if (!board.selected) {
      this.node.innerHTML = 'Component:';
    } else {
      var comp = board.selected;
      var html = 'Component:<br/>';
      html += '<table>';
      html += '<tr><th>Type</th><td>' + comp.className + '</td></tr>';
      if (comp.displayType) html += '<tr><th>Display Type</th><td>' + comp.displayType + '</td></tr>';
      html += '</table>';
      this.node.innerHTML = html;
      if (comp.className == 'Source' || comp.className == 'Display') this.addButton('Change Display', function (e) {
        var types = ['Standard', 'Logic', 'Digital'];
        comp.set('displayType', types[(Math.max(0, types.indexOf(comp.get('displayType'))) + 1) % types.length]);
        board.draw();
      });
      if (comp.className == 'FullAdder') this.addButton('More Inputs', function (e) {
        var dimInputs = comp.getDimInputs();
        comp.setDimInputs(dimInputs+1);
        board.draw();
      });
      if (!comp.isWire && !comp.isConnection && !comp.isSource && !comp.isDisplay) this.addButton('Rotate', function (e) {
        comp.setRotation((comp.getRotation() + 90)); // Need to stick with 90 so wires are always on whole board units
        board.draw();
      });
      if (comp.isWire) this.addButton('Add Waypoint', function (e) {
        var corner = comp.addWaypoint(null, null, true);
        board.select(corner);
        board.startDragging(corner, { x: corner.x, y: corner.y });
        board.draw();
      });
      this.addButton('Delete', function (e) {
        comp.delete();
        this.menu.update(); // update this menu
        board.draw();
      });
    }
  }
  this.update();
  parentNode.appendChild(this.node);
}

/***********************************************
 * Component class
 * Virtual class for all board components
 ***********************************************/
var Component = Class.extend({
  init: function (board) {
    this.board = board;
    this.className = 'Component';
    this.data = 0;
    this.targets = [];
    this.sources = [];
    this.setters = {};
    board.addComponent(this);
  },
  set: function (att, val) {
    if (this.setters[att]) this.setters[att].call(this, val);
    this[att] = val;
    return this;
  },
  get: function (att) {
    return this[att];
  },
  addSetter: function (att, func) {
    this.setters[att] = func;
  },
  setLocation: function (x, y, inCanvasUnits) {
    if (inCanvasUnits) {
      this.x = x;
      this.y = y;
    } else {
      this.x = x * this.board.unit;
      this.y = y * this.board.unit;
    }
    return this;
  },
  addSource: function (component, noCallBack) {
    if (component == this) throw "Trying to connect to self";
    if (this.sources.indexOf(component) == -1) { // if not already connected (as might happen during import
      this.sources.push(component);
      if (noCallBack !== true) {
        component.addTarget(this, true);
      }
    }
    return this;
  },
  addTarget: function (component, noCallBack) {
    if (component == this) throw "Trying to connect to self";
    if (this.targets.indexOf(component) == -1) { // if not already connected (as might happen during import
      this.targets.push(component);
      if (noCallBack !== true) {
        component.addSource(this, true);
      }
      component.setData(this.data);
    }
    return this;
  },
  removeTarget: function (component, noCallBack) {
    removeElementFromArray(this.targets, component);
    if (noCallBack !== true) {
      component.removeSource(this, true);
    }
    return this;
  },
  removeSource: function (component, noCallBack) {
    removeElementFromArray(this.sources, component);
    if (noCallBack !== true) {
      component.removeTarget(this, true);
    }
    this.setData(false);
    return this;
  },
  inputAddedSource: function (component) {
    return this;
  },
  inputRemovedSource: function (component) {
    return this;
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    var oldData = this.data;
    this.data = data;
    if (this.data !== oldData) {
      for (i in this.targets) {
        this.targets[i].setData(data);
      }
    }
    return this;
  },
  containsPoint: function (x, y) {
    return false;
  },
  getRotation: function () {
    if (this.rotation == null) return 0;
    else return Math.round(this.rotation / Math.PI * 180); // convert to degrees
  },
  setRotation: function (degrees) {
    degrees = degrees % 360;
    this.rotation = degrees / 180 * Math.PI; // convert to radians
    this.setLocation(this.x, this.y, true);
    return this;
  },
  scaleX: function (length) {
    if (this.width) return length * this.width;
    else if (this.height) return length * this.height;
    else return length * this.board.unit;
  },
  scaleY: function (length) {
    if (this.height) return length * this.height;
    else return length * this.board.unit;
  },
  setWidth: function (w) {
    this.width = this.board.unit * w;
    return this;
  },
  getWidth: function () {
    if (this.width) return this.width;
    else if (this.height) return this.height;
    else return 0;
  },
  setHeight: function (h) {
    this.height = this.board.unit * h;
    return this;
  },
  getHeight: function () {
    if (this.height) return this.height;
    else return 0;
  },
  getCoords: function (inCanvasUnits) {
    var unit;
    if (inCanvasUnits) unit = 1;
    else unit = this.board.unit;
    coords = {};
    coords.x = Math.round(this.x / unit);
    coords.y = Math.round(this.y / unit);
    return coords;
  },
  getBoundingRect: function() {
    var unit;
    var left = this.x;
    var top = this.y;
    var right = (this.x + this.getWidth());
    var bottom = (this.y + this.getHeight());
    var rect = new Rectangle(left, top, right, bottom);
    return rect;
  },
  /** Get coords relative to the Component.
   * offset(.5,.5) will return the center of the object */
  offset: function (x, y) {
    /*
    var coords = {};
    x = this.scaleX(x); // turn into pixels relative to this.x
    y = this.scaleY(y); // turn into pixels relative to this.y
    if (this.rotation) {
      var width = this.getWidth();
      var height = this.getHeight();
      x = x - width/2;
      y = y - height/2;
      var newx = x*Math.cos(this.rotation) - y*Math.sin(this.rotation);
      var newy = x*Math.sin(this.rotation) + y*Math.cos(this.rotation);
      x = newx + width/2;
      y = newy + height/2;
    }
    coords.x = this.x + x;
    coords.y = this.y + y;
    return coords;
    */
    var width = this.getWidth();
    var height = this.getHeight();
    var pt = new Point((x * width) + this.x, (y * height) + this.y); // turn into canvas units
    var center = new Point(this.x + width / 2, this.y + height / 2);
    return pt.getRotatedClockwise(this.rotation, center);
  },
  getTopParent: function () {
    if (this.parent) return this.parent.getTopParent();
    else return this;
  },
  draw: function (cxt) {
    cxt.lineCap = 'square';
    if (this.selected) {
      cxt.strokeStyle = SELECT_COLOR;
      cxt.shadowBlur = 5;
      cxt.shadowColor = SELECT_BACKGROUND;
      if (this.beingDragged) { // further shadow
        cxt.shadowOffsetX = 5;
        cxt.shadowOffsetY = 5;
      } else {
        cxt.shadowOffsetX = 2;
        cxt.shadowOffsetY = 2;
      }
    } else {
      cxt.strokeStyle = '#000';
    }
    cxt.lineWidth = this.board.unit / 5;
  },
  export: function () {
    if (this.parent) return null; // The parent will include whatever it needs saved
    obj = {};
    obj.className = this.className;
    obj.id = this.id;
    if ("data" in this && this.data !== null) obj.data = this.data;
    if ("x" in this && this.x !== null) obj.x = this.x / this.board.unit;
    if ("y" in this && this.y !== null) obj.y = this.y / this.board.unit;
    if ("rotation" in this && this.rotation !== null) obj.rotation = this.rotation;
    if ("height" in this && this.height !== null) obj.height = this.height / this.board.unit;
    return obj;
  },
  toJSON: function () {
    //return this.export();
    var me = {};
    for (x in this) {
      me[x] = this[x];
    }
    delete me.board;
    delete me.selected;
    delete me.beingDragged;
    delete me.setters;
    delete me.imported;
    delete me.importedObj;
    if (me.parent) {
      me.parent = me.parent.id;
    }
    // @TODO BUG. See bug in function. It needs to be a nested array. Each target can target multiple ids.
    me.targets = this.convertCompArrayToIds(me.targets);
    me.sources = this.convertCompArrayToIds(me.sources);
    me.outputs = this.convertCompArrayToIds(me.outputs);
    me.inputs = this.convertCompArrayToIds(me.inputs);
    me.selects = this.convertCompArrayToIds(me.selects);
    return me;
  },
  import: function (obj) { // import Component
    if (obj.x || obj.y) {
      this.setLocation(obj.x, obj.y);
    }
    if (obj.height) this.setHeight(obj.height);
    if (obj.rotation) this.setRotation(obj.rotation);
    if (obj.data) this.setData(obj.data);
  },
  deleteChildren: function () {
    if (this.inputs) {
      for (var x in this.inputs) {
        this.inputs[x].delete();
        delete (this.inputs[x]);
      }
    }
    if (this.outputs) {
      for (var x in this.outputs) {
        this.outputs[x].delete();
        delete (this.outputs[x]);
      }
    }
    if (this.selects) {
      for (var x in this.selects) {
        this.selects[x].delete();
        delete (this.selects[x]);
      }
    }
    return this;
  },
  delete: function () {
    //if (this.importedObj) throw "Does this happen?"
    this.deleted = true; // indicate is ready to be removed
    this.deleteChildren();
    // disconnect sources and targets and delete wires
    while (this.sources.length > 0) {
      if (this.sources[0].isWire) this.sources[0].delete();
      else this.removeSource(this.sources[0]);
    }
    while (this.targets.length > 0) {
      if (this.targets[0].isWire) this.targets[0].delete();
      else this.removeTarget(this.targets[0]);
    }
    this.board.removeComponent(this);
  }
}); // End Component
/***********************************************
 * Label class
 * A text label
 ***********************************************/
var Label = Component.extend({
  init: function (board) {
    this._super(board);
    this.className = 'Label';
    this.height = this.board.unit;
    this.text = '';
    this.subText = '';
  },
  setSize: function (s) {
    this.setHeight(s);
    return this;
  },
  setText: function (text) {
    this.text = text;
    return this;
  },
  setSubText: function (text) {
    this.subText = text;
    return this;
  },
  containsPoint: function (x, y) {
    return (x >= this.x && x <= this.x + this.height && y >= this.y && y <= this.y + this.height);
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.textBaseline = 'top';
    cxt.fillStyle = '#000';
    cxt.font = '' + this.height + 'px Veranda';
    cxt.fillText(this.text, this.x, this.y);
    var textLen = cxt.measureText(this.text).width;
    cxt.font = '' + (this.height / 2) + 'px Veranda';
    cxt.fillText(this.subText, this.x + textLen, this.y + this.height * 0.4);
    cxt.restore();
    return this;
  }
});
/***********************************************
 * Wire class
 * Connects and transmits data between components
 ***********************************************/
var Wire = Component.extend({
  init: function (board) {
    this._super(board);
    this.className = 'Wire';
    this.isWire = true;
    this.isDraggable = false;
  },
  setData: function (data, setNow) {
    if (this.deleted) return this; // don't bother
    if (setNow) {
      this._super(data);
      this.board.draw();
    } else {
      var me = this;
      //var me_super = me._super;
      setTimeout(function () {
        me.setData(data, true);
      }, this.board.delay);
    }
    return this;
  },
  addWaypoint: function (x, y, returnWaypoint) {
    if (x == null || y == null) {
      x = Math.round((this.sources[0].x + this.targets[0].x) / 2 / this.board.unit); // pick midway point
      y = Math.round((this.sources[0].y + this.targets[0].y) / 2 / this.board.unit); // pick midway point
    }
    // TBD make waypoint a component with a square or circle around the connection?
    var corner = new Connection(this.board).setLocation(x, y);
    var wire = new Wire(this.board).addSource(corner);
    if (this.targets[0]) {
      var endpoint = this.targets[0];
      this.removeTarget(endpoint);
      wire.addTarget(endpoint);
    }
    this.addTarget(corner);
    if (returnWaypoint) return corner;
    else return this;
  },
  addTarget: function (component, noCallBack) {
    for (var i = 0; i < this.sources.length; i++) {
      if (component.getTopParent() == this.sources[i].getTopParent()) throw "Can't connect wire to self";
    }
    return this._super(component, noCallBack);
  },
  addSource: function (component, noCallBack) {
    for (var i = 0; i < this.targets.length; i++) {
      if (component.getTopParent() == this.targets[i].getTopParent()) throw "Can't connect wire to self";
    }
    return this._super(component, noCallBack);
  },
  containsPoint: function (x, y) {
    if (this.sources.length == 0 || this.targets.length == 0) return false;
    if (this.sources[0].containsPoint(x, y) || this.targets[0].containsPoint(x, y)) return false; // let connections win over wire
    var point = { x: x, y: y };
    /* See http://stackoverflow.com/questions/6865832/detecting-if-a-point-is-of-a-line-segment
    if B^2 > A^2 + C^2
        return A
    else if A^2 > B^2 + C^2
        return B
    else
        s = (A+B+C)/2
        return 2/C * sqrt(s*(s-A)*(s-B)*(s-C))
    */
    var a = lineDistance(point, this.sources[0]);
    var b = lineDistance(point, this.targets[0]);
    var c = lineDistance(this.sources[0], this.targets[0]);
    var distanceFromLine;
    if (Math.pow(b, 2) > Math.pow(a, 2) + Math.pow(c, 2)) distanceFromLine = a;
    else if (Math.pow(a, 2) > Math.pow(b, 2) + Math.pow(c, 2)) distanceFromLine = b;
    else {
      var s = (a + b + c) / 2;
      distanceFromLine = 2 / c * Math.sqrt(s * (s - a) * (s - c) * (s - c));
    }
    if (distanceFromLine < 2) return true;
    else return false;
  },
  getBoundingRect: function getBoundingRect() {
    return null; // Is always within others, so skip this.
  },
  draw: function (cxt) {
    if (this.sources.length == 0 || this.targets.length == 0) return;
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.lineWidth = 1;
    if (this.data > 0) {
      cxt.strokeStyle = ON_COLOR;
    } else {
      cxt.strokeStyle = '#000';
    }
    cxt.moveTo(this.sources[0].x, this.sources[0].y);
    cxt.lineTo(this.targets[0].x, this.targets[0].y);
    cxt.stroke();
    cxt.closePath();
    cxt.restore();
    return this;
  },
  export: function () {
    var obj = this._super();
    // Just export the location, will re-connect based on that when imported.
    obj.source = this.sources[0].getCoords();
    obj.target = this.targets[0].getCoords();
    delete obj.data; // Let the wire get computed value once it's reconnected
    return obj;
  },
  import: function (obj) { // import Wire
    this._super(obj);
    var srcCoords = this.board.boardUnitCoordsToPixels(obj.source);
    var src = this.board.findClosestConnection(srcCoords, this.board.unit / 2, function (c) {return true});
    if (!src) {
      console.log(obj);
      throw "Can't find source for wire!";
    }
    this.addSource(src);
    var tgtCoords = this.board.boardUnitCoordsToPixels(obj.target);
    var tgt = this.board.findClosestConnection(tgtCoords, this.board.unit / 2, function (c) {return true});
    if (!tgt) {
      console.log(obj);
      throw "Can't find target for wire!";
    }
    this.addTarget(tgt);
    return obj;
  }
}); // End Wire
/***********************************************
 * Connection class
 * An individual point, typically for another component
 ***********************************************/
var Connection = Component.extend({
  init: function (board, name) {
    this._super(board);
    this.className = 'Connection';
    this.isConnection = true;
    this.isCollector = false; // by default doesn't allow multiple inputs
    this.parent = null;
    this.name = name;
    this.not = false;
    this.isInput = false;
    this.isOutput = false;
    this.closed = false; // this connection is open to sources
  },
  setTypeNot: function () {
    this.not = true;
    return this;
  },
  containsPoint: function (x, y) {
    return (x > this.x - 2 && x < this.x + 2 && y > this.y - 2 && y < this.y + 2);
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.isCollector && this.sources.length > 1) {
      // need to build composite data
      data = 0;
      for (var i = 0; i < this.sources.length; i++) {
        //if (typeof(this.sources[i].data)!='boolean') alert('Error in DrawingBoard.js: unknown composite.');
        if (this.sources[i].data)
          data += Math.pow(2, i);
      }
    }
    return this._super(data);
  },
  addWireTo: function (target, returnWire) {
    var wire = new Wire(this.board).addSource(this).addTarget(target);
    if (returnWire) return wire;
    else return this;
  },
  addSource: function (component, noCallBack) {
    if (!this.acceptingSources()) throw "Connection now allowing new sources";
    if (this.isInput) this.parent.inputAddedSource(this);
    return this._super(component, noCallBack);
  },
  removeSource: function (component, noCallBack) {
    //this.closed = false; // allow source now
    if (this.isInput) this.parent.inputRemovedSource(this);
    return this._super(component, noCallBack);
  },
  acceptingSources: function () {
    if (this.closed || this.isOutput) return false;
    else if (!this.isCollector && this.sources.length > 0) return false;
    else return true;
  },
  acceptingTargets: function () {
    if (this.closed || this.isInput) return false;
    else return true;
  },
  draw: function (cxt) {
    if (this.board.hideEmptyConnections
      && (this.isOutput || this.sources.length == 0)
      && (this.isInput || this.targets.length == 0)
      && this.not == false) return;
    if (this.closed && this.sources.length == 0) return; // don't show empty, closed connections
    var dotSize;
    cxt.save();
    this._super(cxt);
    if (this.not) {
      cxt.fillStyle = '#FFF';
      dotSize = this.board.unit / 3;
      cxt.lineWidth = 2;
    } else {
      cxt.fillStyle = '#000';
      dotSize = 1;
      cxt.lineWidth = .5;
    }
    cxt.beginPath();
    cxt.arc(this.x, this.y, dotSize, 0, Math.PI * 2);
    cxt.stroke();
    cxt.fill();
    cxt.closePath();
    if (this.name && (this.yesLabel || (!this.board.noLabels && !this.noLabel))) {
      cxt.fillStyle = '#000';
      cxt.font = this.scaleY(1) + "px Veranda";
      //cxt.lineWidth = .5;
      if (this.labelLeft) {
        cxt.textAlign = "right"
        var textX = this.x - 3;
      } else {
        cxt.textAlign = "left"
        var textX = this.x + 3;
      }
      var textY = this.y + 3;
      cxt.strokeStyle = '#EEE';
      cxt.strokeText('' + this.name, textX, textY);
      cxt.fillText('' + this.name, textX, textY);
    }
    cxt.restore();
    return this;
  },
  export: function () {
    if (this.parent) return null;
    return this._super();
  }
}); // End Connection class
/***********************************************
 * Source class
 * A source of data to the board.
 ***********************************************/
var Source = Component.extend({ // TODO make this a Gate child
  init: function (board) {
    this._super(board);
    this.className = 'Source';
    this.height = board.unit * 2;
    this.outputs = {};
    this.addOutput('W');
    this.outputs['W'].noLabel = true;
    this.addOutput('X');
    this.outputs['X'].noLabel = true;
    this.addOutput('Y');
    this.outputs['Y'].noLabel = true;
    this.addOutput('Z');
    this.outputs['Z'].noLabel = true;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.outputs['W'].setLocation(this.x + this.height / 2, this.y - 1 + this.height * 0.1, true);
    this.outputs['X'].setLocation(this.x + this.height * 0.9 + 1, this.y + this.height / 2, true);
    this.outputs['Y'].setLocation(this.x + this.height / 2, this.y + this.height * 0.9 + 1, true);
    this.outputs['Z'].setLocation(this.x + this.height * 0.1 - 1, this.y + this.height / 2, true);
    return this;
  },
  addOutput: function (name) {
    this.outputs[name] = new Connection(this.board, name);
    this.outputs[name].setData(this.data);
    this.outputs[name].parent = this;
    this.outputs[name].isOutput = true;
    return this;
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    this._super(data);
    for (i in this.outputs) {
      this.outputs[i].setData(this.data);
    }
    return this;
  },
  containsPoint: function (x, y) {
    return (x >= this.x && x <= this.x + this.height && y >= this.y && y <= this.y + this.height);
  },
  onClick: function (e, coords) {
    if (coords.x >= this.x + this.height * 0.1
      && coords.x <= this.x + this.height * 0.9
      && coords.y >= this.y + this.height * 0.1
      && coords.y <= this.y + this.height * 0.9) {
      if (this.data > 0) {
        this.setData(0);
      } else {
        this.setData(1);
      }
    }
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    if (this.displayType == 'Logic') {
      cxt.beginPath();
      cxt.arc(this.x + this.height * 0.5, this.y + this.height * 0.5, this.height * 0.45, 0, 2 * Math.PI);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height / 2);
      if (this.data > 0) {
        cxt.fillStyle = ON_BACKGROUND;
        var displayText = 'T';
      } else {
        cxt.fillStyle = '#EEE';
        var displayText = 'F';
      }
      cxt.fill();
      cxt.closePath();
      cxt.font = '' + this.height * 0.6 + 'px Veranda';
      cxt.fillStyle = '#000';
      cxt.fillText(displayText, this.x + this.height * 0.3, this.y + this.height * 0.7);
    } else if (this.displayType == 'Digital') {
      cxt.beginPath();
      cxt.arc(this.x + this.height * 0.5, this.y + this.height * 0.5, this.height * 0.45, 0, 2 * Math.PI);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height / 2);
      cxt.fillStyle = '#EEE';
      cxt.fill();
      cxt.closePath();
      cxt.font = '' + this.height * 0.6 + 'px Veranda';
      cxt.fillStyle = '#000';
      cxt.textAlign = "center";
      cxt.textBaseline = "middle";
      if (this.data > 0) {
        var displayText = 0 + this.data;
      } else {
        displayText = '0';
      }
      cxt.fillText(displayText, this.x + this.height * 0.5, this.y + this.height * 0.5);
    } else {
      cxt.beginPath();
      cxt.arc(this.x + this.height * 0.5, this.y + this.height * 0.5, this.height * 0.45, 0, 2 * Math.PI);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height / 2);
      cxt.fillStyle = '#EEE';
      cxt.fill();
      cxt.closePath();
      cxt.beginPath();
      cxt.arc(this.x + this.height * 0.5, this.y + this.height * 0.5, this.height * 0.3, 0, 2 * Math.PI);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height / 2);
      if (this.data > 0) {
        cxt.fillStyle = ON_COLOR;
      } else {
        cxt.fillStyle = '#333';
      }
      cxt.fill();
      cxt.closePath();
    }
    cxt.restore();
    return this;
  },
  export: function() {
    var obj = this._super();
    obj.displayType = this.displayType;
    return obj;
  },
  import: function (obj) {
    this._super(obj);
    this.displayType = obj.displayType;
  }
});
// TODO: Make ParentComponent class that has inputs and outputs so Component class doesn't need to know about it.
/***********************************************
 * Display class
 * A display, which shows the value of data
 ***********************************************/
var Display = Component.extend({
  init: function (board) {
    this._super(board);
    this.className = 'Display';
    this.height = board.unit * 2;
    this.width = this.height;
    this.displayType = 'Standard';
    this.addSetter('displayType', this.setDisplayType);
    this.digits = 1;
    this.inputs = {};
    this.addInput('A');
    this.inputs['A'].noLabel = true;
    this.addInput('B');
    this.inputs['B'].noLabel = true;
    this.addInput('C');
    this.inputs['C'].noLabel = true;
    this.addInput('D');
    this.inputs['D'].noLabel = true;
  },
  setData: function (data) {
    return this._super(data);
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['A'].setLocation(this.x + this.width * 0.2 - 1, this.y + this.height / 2, true);
    this.inputs['B'].setLocation(this.x + this.width / 2, this.y - 1 + this.height * 0.2, true);
    this.inputs['C'].setLocation(this.x + this.width * 0.8 + 1, this.y + this.height / 2, true);
    this.inputs['D'].setLocation(this.x + this.width / 2, this.y + this.height * 0.8 + 1, true);
    return this;
  },
  setMaxDigits: function (d) {
    this.digits = d;
    this.width = this.height + (this.board.unit * (this.digits - 1));
    this.setLocation(this.x, this.y, true); // reset input connections
    return this;
  },
  setHeight: function (h) {
    this.height = this.board.unit * h;
    this.width = this.height + (this.board.unit * (this.digits - 1));
    return this;
  },
  addInput: function (name, returnInput) {
    this.inputs[name] = new Connection(this.board, name);
    this.inputs[name].parent = this;
    this.inputs[name].addTarget(this, true);
    this.inputs[name].isInput = true;
    if (returnInput) return this.inputs[name];
    else return this;
  },
  inputAddedSource: function (component) {
    for (var x in this.inputs) {
      if (this.inputs[x] != component) this.inputs[x].closed = true; // no other inputs should accept sources
    }
    return this._super(component);
  },
  inputRemovedSource: function (component) {
    for (var x in this.inputs) {
      this.inputs[x].closed = false; // all inputs can accept sources
    }
    return this._super(component);
  },
  containsPoint: function (x, y) {
    return (x >= this.x && x <= this.x + this.height && y >= this.y && y <= this.y + this.height);
  },
  setDisplayType: function (type) {
    this.displayType = type;
    for (var x in this.inputs) {
      if (type == 'Digital') {
        this.inputs[x].set('isCollector', true);
      } else {
        this.inputs[x].set('isCollector', false);
      }
    }
    return this;
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    if (this.displayType == 'Logic') {
      cxt.beginPath();
      cxt.moveTo(this.x + this.height * 0.2, this.y + this.height * 0.2);
      cxt.lineTo(this.x + this.height * 0.8, this.y + this.height * 0.2);
      cxt.lineTo(this.x + this.height * 0.8, this.y + this.height * 0.8);
      cxt.lineTo(this.x + this.height * 0.2, this.y + this.height * 0.8);
      cxt.lineTo(this.x + this.height * 0.2, this.y + this.height * 0.2);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height / 2);
      if (this.data > 0) {
        cxt.fillStyle = ON_BACKGROUND;
        var displayText = 'T';
      } else {
        cxt.fillStyle = '#EEE';
        var displayText = 'F';
      }
      cxt.fill();
      cxt.closePath();
      cxt.font = '' + this.height * 0.6 + 'px Veranda';
      cxt.fillStyle = '#000';
      cxt.fillText(displayText, this.x + this.height * 0.3, this.y + this.height * 0.7);
    } else if (this.displayType == 'Digital') {
      cxt.beginPath();
      cxt.moveTo(this.x + this.width * 0.2, this.y + this.height * 0.2);
      cxt.lineTo(this.x + this.width * 0.8, this.y + this.height * 0.2);
      cxt.lineTo(this.x + this.width * 0.8, this.y + this.height * 0.8);
      cxt.lineTo(this.x + this.width * 0.2, this.y + this.height * 0.8);
      cxt.lineTo(this.x + this.width * 0.2, this.y + this.height * 0.2);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.width / 2, this.y + this.height / 2);
      cxt.fillStyle = '#EEE';
      cxt.fill();
      cxt.closePath();
      cxt.font = '' + this.height * 0.6 + 'px Veranda';
      cxt.fillStyle = '#000';
      cxt.textAlign = "end";
      var displayText = 0 + this.data;
      cxt.fillText(displayText, this.x + this.width * 0.7, this.y + this.height * 0.7);
    } else {
      cxt.beginPath();
      cxt.moveTo(this.x + this.height * 0.1, this.y + this.height * 0.1);
      cxt.lineTo(this.x + this.height * 0.9, this.y + this.height * 0.1);
      cxt.lineTo(this.x + this.height * 0.9, this.y + this.height * 0.9);
      cxt.lineTo(this.x + this.height * 0.1, this.y + this.height * 0.9);
      cxt.lineTo(this.x + this.height * 0.1, this.y + this.height * 0.1);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height / 2);
      cxt.fillStyle = '#EEE';
      cxt.fill();
      cxt.closePath();
      cxt.beginPath();
      cxt.moveTo(this.x + this.height * 0.3, this.y + this.height * 0.3);
      cxt.lineTo(this.x + this.height * 0.7, this.y + this.height * 0.3);
      cxt.lineTo(this.x + this.height * 0.7, this.y + this.height * 0.7);
      cxt.lineTo(this.x + this.height * 0.3, this.y + this.height * 0.7);
      cxt.lineTo(this.x + this.height * 0.3, this.y + this.height * 0.3);
      cxt.stroke();
      cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height / 2);
      if (this.data > 0) {
        cxt.fillStyle = ON_COLOR;
      } else {
        cxt.fillStyle = '#333';
      }
      cxt.fill();
      cxt.closePath();
    }
    cxt.restore();
    return this;
  },
  export: function() {
    var obj = this._super();
    obj.displayType = this.displayType;
    obj.digits = this.digits
    return obj;
  },
  import: function (obj) {
    this._super(obj);
    this.setDisplayType(obj.displayType);
    this.setMaxDigits(obj.digits)
  }
}); // End Display class
/***********************************************
 * Gate class
 * Virtual class. A container of components with logic
 ***********************************************/
var Gate = Component.extend({ // rename to ParentComponent???
  init: function (board) {
    this._super(board);
    this.className = 'Gate';
    this.isGate = true;
    this.inputs = {};
    this.outputs = {};
    this.data = null;
    this.height = board.unit * 4;
  },
  setHeight: function (h) {
    this.height = this.board.unit * h;
    this.setLocation(this.x, this.y, true); // set location to adjust children
    return this;
  },
  setData: function (data) {
    throw "Virtual function Gate.setData called.";
    //if (this.deleted) return this; // don't bother
    //console.log('Gate.setData: data='+data);
    // gates don't have data themselves
    // but we'll reset outputs because an input changed
    return this;
  },
  addInput: function (name) {
    this.inputs[name] = new Connection(this.board, name);
    this.inputs[name].addTarget(this);
    this.inputs[name].parent = this;
    this.inputs[name].isInput = true;
    this.setData();
    return this;
  },
  addOutput: function (name) {
    this.outputs[name] = new Connection(this.board, name);
    //this.dataFuncs[name] = dataFunc;
    this.outputs[name].parent = this;
    this.outputs[name].isOutput = true;
    this.outputs[name].labelLeft = true;
    this.setData(); // set datas
    return this;
  },
  containsPoint: function (x, y) {
    var width = (this.width) ? this.width : this.height; // default width to height
    if (this.rotation) {
      var point = new Point(x, y);
      point = point.getRotatedCounterclockwise(this.rotation, new Point(this.x + width / 2, this.y + this.height / 2)); // rotate along with item
      x = point.x; y = point.y;
    }
    return (x >= this.x && x <= this.x + width && y >= this.y && y <= this.y + this.height); // assume a rectangle
  },
  draw: function (cxt) {
    this._super(cxt);
    for (var i in this.inputs) {
      this.inputs[i].draw(cxt);
    }
    for (var i in this.outputs) {
      this.outputs[i].draw(cxt);
    }
    return this;
  },
  toJSON: function () {
    me = this._super();
    //delete me.dataFuncs;
    return me;
  }
});

/***********************************************
 * AndGate class
 * AND gate with two binary inputs and one output
 ***********************************************/
var AndGate = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'AndGate';
    this.addInput('A');
    this.addInput('B');
    this.addOutput('X');
  },
  setData: function (output) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'] && this.inputs['B'])
      this.outputs['X'].setData(this.inputs['A'].data && this.inputs['B'].data);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['A'].setLocation(this.x, this.y + this.height / 4, true);
    this.inputs['B'].setLocation(this.x, this.y + this.height / 4 * 3, true);
    this.outputs['X'].setLocation(this.x + 1 + this.height, this.y + this.height / 2, true);
    return this;
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.moveTo(this.x + 1 + this.height / 2, this.y);
    cxt.lineTo(this.x + 1, this.y);
    cxt.lineTo(this.x + 1, this.y + this.height);
    cxt.lineTo(this.x + 1 + this.height / 2, this.y + this.height);
    cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height);
    cxt.arc(this.x + 1 + this.height / 2, this.y + this.height / 2,
      this.height / 2, Math.PI * .5, Math.PI * 1.5, true);
    cxt.stroke();
    cxt.stroke();
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.restore();
    return this;
  },
});
/***********************************************
 * And3Gate class
 * AND gate with three inputs and one output
 ***********************************************/
var And3Gate = AndGate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'And3Gate';
    this.addInput('C');
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'] && this.inputs['B'] && this.inputs['C'])
      this.outputs['X'].setData(this.inputs['A'].data && this.inputs['B'].data && this.inputs['C'].data);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['B'].setLocation(this.x, this.y + this.height / 2, true);
    this.inputs['C'].setLocation(this.x, this.y + this.height * 3 / 4, true);
    return this;
  }
});
/***********************************************
 * OrGate class
 * OR gate with two binary inputs and one output
 ***********************************************/
var OrGate = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'OrGate';
    this.addInput('A');
    this.addInput('B');
    this.addOutput('X');
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'] && this.inputs['B'])
      this.outputs['X'].setData(this.inputs['A'].data || this.inputs['B'].data);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['A'].setLocation(this.x + this.height * 0.2, this.y + this.height / 4, true);
    this.inputs['B'].setLocation(this.x + this.height * 0.2, this.y + this.height / 4 * 3, true);
    this.outputs['X'].setLocation(this.x + 1 + this.height, this.y + this.height / 2, true);
    return this;
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.moveTo(this.x + 1, this.y);
    cxt.quadraticCurveTo(
      this.x + 1 + this.height * 0.7, this.y
      , this.x + 1 + this.height, this.y + this.height / 2);
    cxt.quadraticCurveTo(
      this.x + 1 + this.height * 0.7, this.y + this.height
      , this.x + 1, this.y + this.height);
    cxt.bezierCurveTo(
      this.x + 1 + this.height * 0.3, this.y + this.height
      , this.x + 1 + this.height * 0.3, this.y
      , this.x + 1, this.y);
    cxt.stroke();
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.restore();
    return this;
  },
});
/***********************************************
 * Or3Gate class
 * OR gate with three binary inputs and one output
 ***********************************************/
var Or3Gate = OrGate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'Or3Gate';
    this.addInput('C');
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'] && this.inputs['B'] && this.inputs['C'])
      this.outputs['X'].setData(this.inputs['A'].data || this.inputs['B'].data || this.inputs['C'].data);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['B'].setLocation(this.x + this.height * 0.2, this.y + this.height / 2, true);
    this.inputs['C'].setLocation(this.x + this.height * 0.2, this.y + this.height / 4 * 3, true);
    return this;
  }
});
/***********************************************
 * NotGate class
 * NOT gate with one binary input and one output
 ***********************************************/
var NotGate = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'NotGate';
    this.height = board.unit * 2;
    this.width = this.height * 1.5;
    this.addInput('A');
    this.addOutput('X');
    this.outputs['X'].setTypeNot();
    this.outputs['X'].labelLeft = this.board.unit * 1.5;
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'])
      this.outputs['X'].setData(this.inputs['A'].data == 0 ? 1 : 0);
    return this;
  },
  setHeight: function (h) {
    this.height = this.board.unit * h;
    this.width = this.height * 1.5;
    this._super(h);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    var c = this.offset(0, .5);
    this.inputs['A'].setLocation(c.x, c.y, true);
    c = this.offset(1, .5);
    this.outputs['X'].setLocation(c.x, c.y, true);
    return this;
  },
  containsPoint: function (x, y) {
    return (x >= this.x && x <= this.x + this.height * 1.5 && y >= this.y && y <= this.y + this.height);
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    var c = this.offset(0, 0);
    cxt.moveTo(c.x, c.y);
    c = this.offset(0, 1);
    cxt.lineTo(c.x, c.y);
    c = this.offset(1, .5);
    cxt.lineTo(c.x, c.y);
    c = this.offset(0, 0);
    cxt.lineTo(c.x, c.y);
    cxt.stroke();
    c = this.offset(.5, .5);
    cxt.moveTo(c.x, c.y);
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.restore();
    return this;
  },
});
/***********************************************
 * NandGate class
 * NAND gate with two binary inputs and one output
 ***********************************************/
var NandGate = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'NandGate';
    this.addInput('A');
    this.addInput('B');
    this.addOutput('X');
    this.outputs['X'].setTypeNot();
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'] && this.inputs['B'])
      this.outputs['X'].setData((this.inputs['A'].data && this.inputs['B'].data) == 0 ? 1 : 0);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['A'].setLocation(this.x, this.y + this.height / 4, true);
    this.inputs['B'].setLocation(this.x, this.y + this.height / 4 * 3, true);
    this.outputs['X'].setLocation(this.x + 1 + this.height, this.y + this.height / 2, true);
    return this;
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.moveTo(this.x + 1 + this.height / 2, this.y);
    cxt.lineTo(this.x + 1, this.y);
    cxt.lineTo(this.x + 1, this.y + this.height);
    cxt.lineTo(this.x + 1 + this.height / 2, this.y + this.height);
    cxt.moveTo(this.x + 1 + this.height / 2, this.y + this.height);
    cxt.arc(this.x + 1 + this.height / 2, this.y + this.height / 2,
      this.height / 2, Math.PI * .5, Math.PI * 1.5, true);
    cxt.stroke();
    cxt.stroke();
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.restore();
    return this;
  },
});
/***********************************************
 * NorGate class
 * NOR gate with two binary inputs and one output
 ***********************************************/
var NorGate = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'NorGate';
    this.addInput('A');
    this.addInput('B');
    this.addOutput('X');
    this.outputs['X'].setTypeNot();
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'] && this.inputs['B'])
      this.outputs['X'].setData((this.inputs['A'].data || this.inputs['B'].data) == 0 ? 1 : 0);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['A'].setLocation(this.x + this.height * 0.2, this.y + this.height / 4, true);
    this.inputs['B'].setLocation(this.x + this.height * 0.2, this.y + this.height / 4 * 3, true);
    this.outputs['X'].setLocation(this.x + 1 + this.height, this.y + this.height / 2, true);
    return this;
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.moveTo(this.x + 1, this.y);
    cxt.quadraticCurveTo(
      this.x + 1 + this.height * 0.7, this.y
      , this.x + 1 + this.height, this.y + this.height / 2);
    cxt.quadraticCurveTo(
      this.x + 1 + this.height * 0.7, this.y + this.height
      , this.x + 1, this.y + this.height);
    cxt.bezierCurveTo(
      this.x + 1 + this.height * 0.3, this.y + this.height
      , this.x + 1 + this.height * 0.3, this.y
      , this.x + 1, this.y);
    cxt.stroke();
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.restore();
    return this;
  },
});
/***********************************************
 * XorGate class
 * XOR gate 2 in, 1 out
 ***********************************************/
var XorGate = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'XorGate';
    this.addInput('A');
    this.addInput('B');
    this.addOutput('X');
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    if (this.outputs['X'] && this.inputs['A'] && this.inputs['B'])
      this.outputs['X'].setData((this.inputs['A'].data || this.inputs['B'].data) && !(this.inputs['A'].data && this.inputs['B'].data) ? 1 : 0);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    this.inputs['A'].setLocation(this.x + this.height * 0.2, this.y + this.height / 4, true);
    this.inputs['B'].setLocation(this.x + this.height * 0.2, this.y + this.height / 4 * 3, true);
    this.outputs['X'].setLocation(this.x + 1 + this.height, this.y + this.height / 2, true);
    return this;
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.moveTo(this.x + 1, this.y);
    cxt.quadraticCurveTo(
      this.x + 1 + this.height * 0.7, this.y
      , this.x + 1 + this.height, this.y + this.height / 2);
    cxt.quadraticCurveTo(
      this.x + 1 + this.height * 0.7, this.y + this.height
      , this.x + 1, this.y + this.height);
    cxt.bezierCurveTo(
      this.x + 1 + this.height * 0.3, this.y + this.height
      , this.x + 1 + this.height * 0.3, this.y
      , this.x + 1, this.y);
    cxt.stroke();
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.beginPath();
    cxt.moveTo(this.x + 1 - this.height * 0.15, this.y + this.height);
    cxt.bezierCurveTo(
      this.x + 1 + this.height * 0.15, this.y + this.height
      , this.x + 1 + this.height * 0.15, this.y
      , this.x + 1 - this.height * 0.15, this.y);
    cxt.stroke();
    cxt.closePath();
    cxt.restore();
    return this;
  },
});
/***********************************************
 * FullAdder class
 * Full adder with three binary inputs and two outputs
 ***********************************************/
var FullAdder = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'FullAdder';
    this.addInput('C');
    this.addOutput('C');
    this.setDimInputs(1);
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    var sum = 0;
    if (this.inputs['C']) sum += this.inputs['C'].data;
    for (var i = 0; i < this.getDimInputs(); i++) {
      if (this.inputs['A' + i]) sum += this.inputs['A' + i].data * Math.pow(2, i);
      if (this.inputs['B' + i]) sum += this.inputs['B' + i].data * Math.pow(2, i);
    }
    if (this.outputs['C']) this.outputs['C'].setData((Math.floor(sum / Math.pow(2, this.getDimInputs())) % 2) == 1);
    for (var i = 0; i < this.getDimInputs(); i++) {
      if (this.outputs['S' + i]) this.outputs['S' + i].setData((Math.floor(sum / Math.pow(2, i)) % 2) == 1);
    }
    return this;
  },
  getDimInputs: function () {
    return (Object.keys(this.inputs).length - 1) / 2; // don't count Cout and count A+B as one
  },
  setDimInputs: function (n) {
    if (n < this.getDimInputs()) throw "setDimInputs to lower value not supported"
    for (var i = 0; i < n; i++) {
      if (this.getDimInputs() <= i) {
        this.addInput('A' + i);
        this.addInput('B' + i);
        this.addOutput('S' + i);
      }
    }
    this.setHeight(2 + 2 * n);
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    var height = this.getHeight()
    var dimInputs = this.getDimInputs()
    var topleft = this.offset(0,0)
    var topright = this.offset(1,0)
    var space = height / (2 + dimInputs * 2); // the space above, below, and between each dot in a set of inputs/outputs
    var unit = this.board.unit / this.height; // percentage of height that is one board unit
    //this.inputs['C'].setLocation(topleft.x, topleft.y + space, true)
    var c = this.offset(0, unit * 1); this.inputs['C'].setLocation(c.x, c.y, true);
    //this.outputs['C'].setLocation(topright.x, topright.y + space * (1 + dimInputs * 2), true)
    c = this.offset(1, unit * (1 + dimInputs * 2)); this.outputs['C'].setLocation(c.x, c.y, true);
    for (var i = 0; i < dimInputs; i++) {
      //this.inputs['A' + i].setLocation(topleft.x, topleft.y + space * (2 + i), true); // Start just after Cin
      c = this.offset(0, unit * (i + 2)); this.inputs['A' + i].setLocation(c.x, c.y, true);
      //this.inputs['B' + i].setLocation(topleft.x, topleft.y + space * (2 + dimInputs + i), true); // Start after A0-n
      c = this.offset(0, unit * (i + 2 + dimInputs)); this.inputs['B' + i].setLocation(c.x, c.y, true);
      //this.outputs['S' + i].setLocation(topright.x, topright.y + space * (1 + i), true); // Start at top right
      c = this.offset(1, unit * (i + 1)); this.outputs['S' + i].setLocation(c.x, c.y, true);
    }
    return this;
  },
  draw: function (cxt) {
    cxt.save();
    this._super(cxt);
    cxt.beginPath();
    cxt.lineWidth = this.board.unit / 10; // not sure why this is needed
    c = this.offset(0, 0); cxt.moveTo(c.x, c.y);
    c = this.offset(1, 0); cxt.lineTo(c.x, c.y);
    c = this.offset(1, 1); cxt.lineTo(c.x, c.y);
    c = this.offset(0, 1); cxt.lineTo(c.x, c.y);
    c = this.offset(0, 0); cxt.lineTo(c.x, c.y);
    cxt.stroke();
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.save(); // save for rotation
    cxt.beginPath();
    cxt.fillStyle = '#000';
    cxt.textAlign = "center";
    cxt.textBaseline = "middle";
    cxt.font = 'bold ' + (this.height / 2) + 'px Veranda';
    cxt.shadowColor = "#0000"; // turn off shadow
    cxt.translate(this.x + this.getWidth() / 2, this.y + this.getHeight() / 2); // make center into 0,0
    //var degrees = this.getRotation();
    cxt.rotate(this.rotation);
    cxt.fillText('+', 0, 0); // centered
    cxt.closePath();
    cxt.restore(); // restore rotation
    cxt.restore();
    return this;
  },
  export: function() {
    var obj = this._super();
    obj.dimInputs = this.getDimInputs();
    return obj;
  },
  import: function (obj) {
    this._super(obj);
    if (obj.dimInputs) this.setDimInputs(obj.dimInputs);
  }
});
/***********************************************
 * MuxGate class
 * Multiplexer gate with selectable number of inputs
 ***********************************************/
var MuxGate = Gate.extend({
  init: function (board) {
    this._super(board);
    this.className = 'MuxGate';
    this.selects = [];
    this.addOutput('X');
    this.setNumSelects(1);
    this.setNumInputs(2);
  },
  setData: function (data) {
    if (this.deleted) return this; // don't bother
    var selection = '';
    for (var i = 0; i < this.selects.length; i++) {
      var temp = (0 + this.selects[i].data)
      temp = temp.toString(2)
      selection = temp + selection;
    }
    if (selection == '') selection = '0000';
    selection = parseInt(selection, 2);
    if (selection < this.getNumInputs()) {
      var result = this.inputs[selection].data;
    } else {
      result = false;
    }
    this.outputs['X'].setData(result);
    return this;
  },
  getNumInputs: function () {
    return Object.keys(this.inputs).length;
  },
  setNumInputs: function (n) {
    for (var i = 0; i < n; i++) {
      if (this.getNumInputs() <= i) {
        this.addInput(i);
        this.inputs[i].yesLabel = true;
      }
    }
    this.setNumSelects(Math.ceil(Math.log(n) / Math.LN2));
    this.setHeight(2 + 2 * (n - 1));
    return this;
  },
  setNumSelects: function (n) {
    for (var i = 0; i < n; i++) {
      if (this.selects.length <= i) {
        this.addSelect(i.toString());
      }
    }
    this.setWidth(4 + 2 * (n - 1));
    this.renameInputs();
    return this;
  },
  renameInputs: function () {
    for (var i = 0; i < this.getNumInputs(); i++) {
      this.inputs[i].name = pad(i.toString(2), this.selects.length, '0');
    }
  },
  addSelect: function (name) {
    this.selects[name] = new Connection(this.board, name);
    this.selects[name].parent = this;
    this.selects[name].addTarget(this, true);
    this.selects[name].isInput = true;
    this.selects[name].isSelectInput = true;
    this.setData();
    return this;
  },
  setLocation: function (x, y, inCanvasUnits) {
    this._super(x, y, inCanvasUnits);
    var c = this.offset(1, .5); this.outputs['X'].setLocation(c.x, c.y, true)
    var unit = this.board.unit / this.height; // percentage of height that is one board unit
    for (var i = 0; i < this.getNumInputs(); i++) {
      var c = this.offset(0, unit * (2 * i + 1)); this.inputs[i].setLocation(c.x, c.y, true);
    }
    var unit = this.board.unit / this.width;
    for (var i = 0; i < this.selects.length; i++) {
      var c = this.offset(1 - unit * (2 * i + 2), 0); this.selects[i].setLocation(c.x, c.y, true);
    }
    return this;
  },
  draw: function (cxt) {
    var c;
    cxt.save();
    this._super(cxt);
    for (var i in this.selects) {
      this.selects[i].draw(cxt);
    }
    cxt.beginPath();
    c = this.offset(0, 0); cxt.moveTo(c.x, c.y);
    c = this.offset(1, 0); cxt.lineTo(c.x, c.y);
    c = this.offset(1, 1); cxt.lineTo(c.x, c.y);
    c = this.offset(0, 1); cxt.lineTo(c.x, c.y);
    c = this.offset(0, 0); cxt.lineTo(c.x, c.y);
    cxt.stroke();
    cxt.fillStyle = '#EEE';
    cxt.fill();
    cxt.closePath();
    cxt.save(); // save for rotation
    cxt.beginPath();
    cxt.fillStyle = '#000';
    cxt.textAlign = "center";
    cxt.textBaseline = "middle";
    cxt.font = '' + (this.height / 4) + 'px Veranda';
    cxt.shadowColor = "#0000"; // turn off shadow
    cxt.translate(this.x + this.getWidth() / 2, this.y + this.getHeight() / 2);
    var degrees = this.getRotation();
    if (degrees <= 45 - 4 || degrees > 315 + 4) {
      cxt.rotate(this.rotation);
      cxt.fillText('M', 0, this.getHeight() / -4);
      cxt.fillText('U', 0, 0);
      cxt.fillText('X', 0, this.getHeight() / 4);
    } else if (degrees <= 135 - 4) {
      cxt.rotate(this.rotation - Math.PI / 2);
      cxt.fillText('M', this.getHeight() / -4, 0);
      cxt.fillText('U', 0, 0);
      cxt.fillText('X', this.getHeight() / 4, 0);
    } else if (degrees <= 225 - 4) {
      cxt.rotate(this.rotation - Math.PI);
      cxt.fillText('M', 0, this.getHeight() / -4);
      cxt.fillText('U', 0, 0);
      cxt.fillText('X', 0, this.getHeight() / 4);
    } else {
      cxt.rotate(this.rotation - 3 * Math.PI / 2);
      cxt.fillText('M', this.getHeight() / -4, 0);
      cxt.fillText('U', 0, 0);
      cxt.fillText('X', this.getHeight() / 4, 0);
    }
    /*
    if (degrees<=45-4 || degrees>225+4) {
      c = this.offset(0.5,0.25); cxt.fillText('M',c.x,c.y);
      c = this.offset(0.5,0.5); cxt.fillText('U',c.x,c.y);
      c = this.offset(0.5,0.75); cxt.fillText('X',c.x,c.y);
    } else {
      c = this.offset(0.5,0.25); cxt.fillText('X',c.x,c.y);
      c = this.offset(0.5,0.5); cxt.fillText('U',c.x,c.y);
      c = this.offset(0.5,0.75); cxt.fillText('M',c.x,c.y);
    }
    */
    cxt.closePath();
    cxt.restore(); // restore rotation
    cxt.restore();
    return this;
  },
  export: function() {
    var obj = this._super();
    obj.numInputs = this.getNumInputs();
    return obj;
  },
  import: function (obj) {
    this._super(obj);
    if (obj.numInputs) this.setNumInputs(obj.numInputs);
  }
}); // End MuxGate

/***********************************************
 * Point function
 * All coordinates are in canvas units unless otherwise stated
 ***********************************************/
function Point(x, y) {
  if (typeof x != "number" || typeof y != "number") {
    throw "Unexpected input to Point";
  }
  this.x = x;
  this.y = y;
  this.get = function (att) {
    return this[att];
  }
  this.set = function (att, val) {
    this[att] = val;
    return this;
  }
  this.getDistanceTo = function (point) {
    return Math.sqrt(Math.pow(point.x - this.x, 2) + Math.pow(point.y - this.y, 2)); // good ol' A^2 + B^2 = C^2
  }
  this.getRotatedCounterclockwise = function (rotation, center) {
    rotation = 2 * Math.PI - rotation;
    return this.getRotatedClockwise(rotation, center);
  }
  this.getRotatedClockwise = function (rotation, center) {
    if (rotation == null) { // don't bother
      var newPoint = new Point(this.x, this.y);
    } else {
      if (center == null) center = new Point(0, 0);
      var origX = this.x - center.x;
      var origY = this.y - center.y;
      var newX = origX * Math.cos(rotation) - origY * Math.sin(rotation);
      var newY = origX * Math.sin(rotation) + origY * Math.cos(rotation);
      var newPoint = new Point(newX + center.x, newY + center.y);
    }
    return newPoint;
  }
}
/***********************************************
 * Rectangle function
 * In canvas units unless otherwise noted
 ***********************************************/
function Rectangle(left, top, right, bottom) {
  if (typeof left == "number") {
    this.left = left;
    this.top = top;
    this.right = right;
    this.bottom = bottom;
  } else { // expect two points
    this.left = left.x;
    this.top = left.y;
    this.right = top.x;
    this.bottom = top.y;
  };
  this.get = function (att) {
    return this[att];
  };
  this.set = function (att, val) {
    this[att] = val;
    return this;
  };
  this.getWidth = function getWidth() {
    return this.right - this.left;
  };
  this.getHeight = function getHeight() {
    return this.bottom - this.top;
  };
  this.getPointFromNormalizedCoords = function getPointFromNormalizedCoords(xPct, yPct) {
    var x = Math.round(this.left + (this.right - this.left) * xPct);
    var y = Math.round(this.top + (this.bottom - this.top) * yPct);
    return new Point(x, y);
  };
}

/***********************************************
 * pad function
 * Right justify number to the given length with specified pad char
 ***********************************************/
function pad(number, length, pad) {
  var str = '' + number;
  while (str.length < length) {
    str = pad + str;
  }
  return str;
}
function isCanvasSupported() {
  var elem = document.createElement('canvas');
  return !!(elem.getContext && elem.getContext('2d'));
}
function removeElementFromArray(arr, elem) {
  arr.splice(arr.indexOf(elem), 1);
}
function lineDistance(point1, point2) {
  var xs = 0;
  var ys = 0;
  xs = point2.x - point1.x;
  xs = xs * xs;
  ys = point2.y - point1.y;
  ys = ys * ys;
  return Math.sqrt(xs + ys);
}
