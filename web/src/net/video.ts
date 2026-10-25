// پخش تصویر: فریم‌های VP9/VP8/AV1/H264 با WebCodecs رمزگشایی و روی canvas کشیده می‌شوند
import { alog } from '../log';
import type { Msg } from './proto';

type CodecKey = 'vp9s' | 'vp8s' | 'av1s' | 'h264s' | 'h265s';

const CODEC_STRING: Record<CodecKey, string> = {
  vp9s: 'vp09.00.10.08',
  vp8s: 'vp8',
  av1s: 'av01.0.05M.08',
  h264s: 'avc1.64002A',
  h265s: 'hev1.1.6.L93.B0',
};

export interface DecodeAbility {
  vp9: boolean;
  vp8: boolean;
  av1: boolean;
  h264: boolean;
}

export function webCodecsAvailable(): boolean {
  return typeof window !== 'undefined' && 'VideoDecoder' in window && 'EncodedVideoChunk' in window;
}

async function supported(codec: string): Promise<boolean> {
  try {
    const r = await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true });
    return !!r.supported;
  } catch {
    return false;
  }
}

export async function decodeAbility(): Promise<DecodeAbility> {
  if (!webCodecsAvailable()) return { vp9: false, vp8: false, av1: false, h264: false };
  const [vp9, vp8, av1, h264] = await Promise.all(
    [CODEC_STRING.vp9s, CODEC_STRING.vp8s, CODEC_STRING.av1s, CODEC_STRING.h264s].map(supported),
  );
  return { vp9, vp8, av1, h264 };
}

export class VideoSink {
  private decoder: VideoDecoder | null = null;
  private codec: CodecKey | null = null;
  private waitKey = true;
  private ts = 0;
  private ctx: CanvasRenderingContext2D | null;
  frames = 0;
  /** برای لاگ وقتی تصویر نمی‌آید: چند بستهٔ تصویر و چند فریم کلیدی رسیده */
  chunks = 0;
  keys = 0;
  /** فریم کلیدی لازم است (بعد از خطا یا تغییر کدک) */
  onNeedKeyframe: (() => void) | null = null;
  onSize: ((w: number, h: number) => void) | null = null;
  /** این مرورگر این کدک را رمزگشایی نمی‌کند (خطاهای پشت‌سرهم) */
  onFatal: (() => void) | null = null;
  private failures: number[] = [];
  private dead = false;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  }

  get codecName(): string {
    return this.codec ? this.codec.replace(/s$/, '').toUpperCase() : '';
  }

  push(vf: Msg) {
    const kind = vf.union as CodecKey | undefined;
    if (this.dead) return;
    if (!kind || !(kind in CODEC_STRING)) {
      if (this.chunks++ === 0) alog('video: unsupported frame type', kind ?? 'none');
      return;
    }
    if (kind !== this.codec || !this.decoder || this.decoder.state === 'closed') this.configure(kind);
    const decoder = this.decoder;
    if (!decoder) return;
    for (const f of vf[kind].frames || []) {
      this.chunks += 1;
      if (f.key) this.keys += 1;
      if (this.waitKey && !f.key) continue;
      this.waitKey = false;
      // صف رمزگشا بیش از حد پر شده: یک فریم کلیدی تازه می‌خواهیم و تا آن موقع فریم‌ها را دور می‌ریزیم
      if (decoder.decodeQueueSize > 30) {
        this.resetForKeyframe();
        return;
      }
      this.ts += 16_667;
      try {
        decoder.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: this.ts, data: f.data }));
      } catch (e) {
        alog('video: decode threw', kind, e instanceof Error ? e.message : String(e));
        this.resetForKeyframe();
        return;
      }
    }
  }

  private configure(kind: CodecKey) {
    this.close();
    if (kind !== this.codec) alog('video: codec', kind);
    this.codec = kind;
    this.waitKey = true;
    try {
      this.decoder = new VideoDecoder({
        output: (frame) => this.draw(frame),
        error: (e) => {
          alog('video: decoder error', kind, e.message);
          this.resetForKeyframe();
        },
      });
      this.decoder.configure({ codec: CODEC_STRING[kind], optimizeForLatency: true });
    } catch (e) {
      alog('video: configure failed', kind, e instanceof Error ? e.message : String(e));
      this.decoder = null;
    }
    this.onNeedKeyframe?.();
  }

  private resetForKeyframe() {
    const kind = this.codec;
    this.close();
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < 10_000);
    this.failures.push(now);
    if (this.failures.length > 5) {
      alog('video: too many decoder errors', kind);
      this.dead = true;
      this.onFatal?.();
      return;
    }
    if (kind) this.configure(kind);
  }

  private draw(frame: VideoFrame) {
    try {
      const w = frame.displayWidth;
      const h = frame.displayHeight;
      if (this.canvas.width !== w || this.canvas.height !== h || this.frames === 0) {
        if (this.frames === 0) alog('video: first frame', this.codec, `${w}x${h}`);
        this.canvas.width = w;
        this.canvas.height = h;
        this.onSize?.(w, h);
      }
      this.ctx?.drawImage(frame, 0, 0, w, h);
      this.frames += 1;
    } finally {
      frame.close();
    }
  }

  close() {
    if (this.decoder && this.decoder.state !== 'closed') {
      try {
        this.decoder.close();
      } catch {
        /* already closed */
      }
    }
    this.decoder = null;
  }
}
