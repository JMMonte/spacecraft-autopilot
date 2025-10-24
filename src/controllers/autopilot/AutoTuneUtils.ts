import * as THREE from 'three';

export function computeAxisInertia(mass: number, size: THREE.Vector3): { x: number; y: number; z: number } {
  const w = size.x, h = size.y, d = size.z;
  const Ix = (1 / 12) * mass * (h * h + d * d);
  const Iy = (1 / 12) * mass * (w * w + d * d);
  const Iz = (1 / 12) * mass * (w * w + h * h);
  return { x: Ix, y: Iy, z: Iz };
}

export function fitExponentialTau(samples: Array<{ t: number; e: number }>): number {
  const pts = samples.filter(s => s.e > 1e-6);
  if (pts.length < 3) return 1.0;
  let sumT = 0, sumY = 0, sumTT = 0, sumTY = 0;
  for (const s of pts) {
    const y = Math.log(s.e);
    sumT += s.t; sumY += y; sumTT += s.t * s.t; sumTY += s.t * y;
  }
  const n = pts.length;
  const denom = n * sumTT - sumT * sumT;
  if (Math.abs(denom) < 1e-9) return 1.0;
  const slope = (n * sumTY - sumT * sumY) / denom; // ln e = c + slope * t
  const tau = slope < -1e-6 ? -1 / slope : 1.0;
  return Math.max(0.05, Math.min(10.0, tau));
}

