// Fullscreen drifting fog: one fragment shader on a single fullscreen triangle
// (plain WebGL, no Three.js). Colours come from the CSS custom properties
// --color-fog-dark / --color-fog / --color-fog-light / --color-glow, so the
// tokens in styles.css stay the single source of truth.
import { useEffect, useRef, useState } from 'react'

const VERTEX = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

// Tuned values: do not change the numbers.
const FRAGMENT = `
precision mediump float;
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uFog;
uniform vec3 uLight;
uniform vec3 uDark;
uniform vec3 uGlow;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p *= 2.0;
    amp *= 0.5;
  }
  return value;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float n = fbm(p * 1.6 + vec2(uTime * 0.03, uTime * 0.018));
  float n2 = fbm(p * 3.0 - vec2(uTime * 0.02, -uTime * 0.012) + n);
  float r = length(p);

  vec3 col = mix(uDark, uFog, smoothstep(1.1, 0.2, r));
  col = mix(col, uLight, smoothstep(0.6, 0.0, r));
  col += (n2 - 0.5) * 0.09;
  col = mix(col, uGlow, exp(-r * r * 14.0) * 0.75);

  float grain = hash(vUv * uRes + fract(uTime) * 97.0) - 0.5;
  col += grain * 0.035;
  gl_FragColor = vec4(col, 1.0);
}
`

const MAX_DPR = 1.5

// Raw 0–1 channel values (hex / 255), deliberately with no sRGB→linear
// conversion: the shader output goes straight to the sRGB canvas.
function tokenColor(name) {
  const hex = getComputedStyle(document.documentElement).getPropertyValue(name).trim().replace('#', '')
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
}

function isLowEndPhone() {
  const mem = navigator.deviceMemory ?? Infinity
  const cores = navigator.hardwareConcurrency ?? Infinity
  return window.innerWidth < 640 && (mem <= 4 || cores <= 4)
}

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader)
    gl.deleteShader(shader)
    throw new Error(`fog shader: ${log}`)
  }
  return shader
}

export function FogBackground() {
  const hostRef = useRef(null)
  const [fallback, setFallback] = useState(false)

  useEffect(() => {
    if (isLowEndPhone()) {
      setFallback(true)
      return
    }

    const host = hostRef.current
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false })
    if (!gl) {
      setFallback(true)
      return
    }

    let program, vs, fs, buffer
    try {
      vs = compile(gl, gl.VERTEX_SHADER, VERTEX)
      fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT)
      program = gl.createProgram()
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    } catch (err) {
      console.warn(err)
      setFallback(true)
      return
    }
    gl.useProgram(program)

    // One triangle that covers the viewport: x,y position then u,v.
    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 0, 3, -1, 2, 0, -1, 3, 0, 2]), gl.STATIC_DRAW)
    const aPos = gl.getAttribLocation(program, 'position')
    const aUv = gl.getAttribLocation(program, 'uv')
    gl.enableVertexAttribArray(aPos)
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0)
    gl.enableVertexAttribArray(aUv)
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8)

    const u = (name) => gl.getUniformLocation(program, name)
    const uTime = u('uTime')
    const uRes = u('uRes')
    gl.uniform3fv(u('uDark'), tokenColor('--color-fog-dark'))
    gl.uniform3fv(u('uFog'), tokenColor('--color-fog'))
    gl.uniform3fv(u('uLight'), tokenColor('--color-fog-light'))
    gl.uniform3fv(u('uGlow'), tokenColor('--color-glow'))

    host.appendChild(canvas)

    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    const start = performance.now()
    let raf = 0
    let lost = false

    const draw = (seconds) => {
      gl.uniform1f(uTime, seconds)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      canvas.width = Math.max(1, Math.round(window.innerWidth * dpr))
      canvas.height = Math.max(1, Math.round(window.innerHeight * dpr))
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.uniform2f(uRes, canvas.width, canvas.height)
      if (motion.matches && !lost) draw(0) // reduced motion: one static frame
    }

    const frame = () => {
      draw((performance.now() - start) / 1000)
      raf = requestAnimationFrame(frame)
    }
    const play = () => {
      if (raf || lost || motion.matches || document.hidden) return
      raf = requestAnimationFrame(frame)
    }
    const pause = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }

    const onVisibility = () => (document.hidden ? pause() : play())
    const onMotionChange = () => {
      pause()
      if (motion.matches) draw(0)
      else play()
    }
    const onLost = (e) => {
      e.preventDefault()
      lost = true
      pause()
      setFallback(true)
    }

    resize()
    play()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', onVisibility)
    motion.addEventListener('change', onMotionChange)
    canvas.addEventListener('webglcontextlost', onLost)

    return () => {
      pause()
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', onVisibility)
      motion.removeEventListener('change', onMotionChange)
      canvas.removeEventListener('webglcontextlost', onLost)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
      canvas.remove()
    }
  }, [])

  return <div ref={hostRef} className={fallback ? 'fog fog--fallback' : 'fog'} aria-hidden="true" />
}
