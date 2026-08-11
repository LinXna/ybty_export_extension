(() => {
  "use strict";

  const proto = window.CanvasRenderingContext2D?.prototype;
  if (!proto || proto.__codexOddsCaptureInstalled) return;

  Object.defineProperty(proto, "__codexOddsCaptureInstalled", {
    value: true,
    configurable: false
  });

  const originalFillText = proto.fillText;
  const originalStrokeText = proto.strokeText;
  const originalClearRect = proto.clearRect;

  function remember(context, method, text, x, y) {
    const canvas = context.canvas;
    if (!canvas) return;
    let commands = [];
    try {
      commands = JSON.parse(canvas.dataset.codexCanvasText || "[]");
    } catch {
      commands = [];
    }
    commands.push({
      method,
      text: String(text ?? ""),
      x: Number(x),
      y: Number(y),
      font: String(context.font || ""),
      fillStyle: String(context.fillStyle || ""),
      timestamp: Date.now()
    });
    canvas.dataset.codexCanvasText = JSON.stringify(commands.slice(-30));
  }

  proto.fillText = function (...args) {
    remember(this, "fillText", args[0], args[1], args[2]);
    return originalFillText.apply(this, args);
  };

  proto.strokeText = function (...args) {
    remember(this, "strokeText", args[0], args[1], args[2]);
    return originalStrokeText.apply(this, args);
  };

  proto.clearRect = function (...args) {
    if (
      this.canvas &&
      Number(args[0]) <= 0 &&
      Number(args[1]) <= 0 &&
      Number(args[2]) >= this.canvas.width &&
      Number(args[3]) >= this.canvas.height
    ) {
      this.canvas.dataset.codexCanvasText = "[]";
    }
    return originalClearRect.apply(this, args);
  };
})();
