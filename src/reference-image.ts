/**
 * Optional underlay for tracing a locally selected reference image.
 * This layer is deliberately ephemeral: it never uploads or persists image data.
 */
export class ReferenceImageLayer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly root: HTMLDivElement;
  private readonly fileInput: HTMLInputElement;
  private readonly opacityInput: HTMLInputElement;
  private readonly removeButton: HTMLButtonElement;
  private image: HTMLImageElement | null = null;
  private objectUrl: string | null = null;
  private opacity = 0.35;
  private readonly handleResize = () => this.draw();

  /** Called after the selected image has loaded or has been removed. */
  onchange?: (hasImage: boolean) => void;

  constructor(canvas: HTMLCanvasElement, controlsContainer: HTMLElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Reference image canvas 2D context is unavailable");
    this.ctx = ctx;

    this.root = document.createElement("div");
    this.root.className = "reference-image-controls";

    this.fileInput = document.createElement("input");
    this.fileInput.type = "file";
    this.fileInput.accept = "image/*";
    this.fileInput.setAttribute("aria-label", "导入描摹底图");

    const opacityLabel = document.createElement("label");
    opacityLabel.className = "reference-image-opacity-label";
    opacityLabel.textContent = "底图透明度";
    this.opacityInput = document.createElement("input");
    this.opacityInput.type = "range";
    this.opacityInput.min = "0";
    this.opacityInput.max = "1";
    this.opacityInput.step = "0.01";
    this.opacityInput.value = String(this.opacity);
    this.opacityInput.setAttribute("aria-label", "底图透明度");
    opacityLabel.append(this.opacityInput);

    this.removeButton = document.createElement("button");
    this.removeButton.type = "button";
    this.removeButton.textContent = "移除底图";
    this.removeButton.disabled = true;

    this.root.append(this.fileInput, opacityLabel, this.removeButton);
    controlsContainer.append(this.root);

    this.fileInput.addEventListener("change", () => this.selectFile());
    this.opacityInput.addEventListener("input", () => {
      this.opacity = Number(this.opacityInput.value);
      this.draw();
    });
    this.removeButton.addEventListener("click", () => this.clear());
    window.addEventListener("resize", this.handleResize);
  }

  /** Explicit redraw hook for hosts that resize or clear the canvas. */
  draw(): void {
    const width = this.canvas.width || 800;
    const height = this.canvas.height || 600;
    this.ctx.clearRect(0, 0, width, height);
    if (!this.image) return;

    const scale = Math.min(width / this.image.naturalWidth, height / this.image.naturalHeight);
    const drawWidth = this.image.naturalWidth * scale;
    const drawHeight = this.image.naturalHeight * scale;
    this.ctx.globalAlpha = this.opacity;
    this.ctx.drawImage(this.image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    this.ctx.globalAlpha = 1;
  }

  /** Releases image resources and removes the controls and resize listener. */
  destroy(): void {
    this.clear();
    window.removeEventListener("resize", this.handleResize);
    this.root.remove();
  }

  private selectFile(): void {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      this.fileInput.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      this.fileInput.value = "";
      return;
    }

    this.releaseUrl();
    const url = URL.createObjectURL(file);
    this.objectUrl = url;
    const nextImage = new Image();
    nextImage.onload = () => {
      if (this.objectUrl !== url) return;
      this.image = nextImage;
      this.removeButton.disabled = false;
      this.draw();
      this.onchange?.(true);
    };
    nextImage.onerror = () => {
      if (this.objectUrl !== url) return;
      this.clear();
      this.fileInput.value = "";
    };
    nextImage.src = url;
  }

  private clear(): void {
    this.image = null;
    this.releaseUrl();
    this.fileInput.value = "";
    this.removeButton.disabled = true;
    this.draw();
    this.onchange?.(false);
  }

  private releaseUrl(): void {
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }
}
