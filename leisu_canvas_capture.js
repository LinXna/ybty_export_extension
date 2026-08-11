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

  // 使用 WeakMap 在内存中直接维护 Canvas 对应的指令数组，避免高频 JSON.parse 开销
  const canvasCommandsMap = new WeakMap();

  function remember(context, method, text, x, y) {
    const canvas = context.canvas;
    if (!canvas) return;

    let commands = canvasCommandsMap.get(canvas);
    if (!commands) {
      commands = [];
      canvasCommandsMap.set(canvas, commands);
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

    if (commands.length > 30) {
      commands.shift();
    }

    // 同步写入 DOM 属性以供 ISOLATED 作用域脚本读取
    canvas.dataset.codexCanvasText = JSON.stringify(commands);
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
      canvasCommandsMap.set(this.canvas, []);
      this.canvas.dataset.codexCanvasText = "[]";
    }
    return originalClearRect.apply(this, args);
  };
})();