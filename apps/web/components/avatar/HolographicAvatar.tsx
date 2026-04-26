"use client";

// JARVIS holographic avatar — pure procedural geometry, no external assets.
// Iron-Man-style rotating rings around a pulsing core, driven by audioLevel
// so the whole thing breathes with ElevenLabs TTS playback. No RPM, no .glb,
// nothing to 404.

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface AvatarProps {
  audioLevel: number;
  speaking: boolean;
}

function Core({ audioLevel, speaking }: AvatarProps) {
  const coreRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const ring1Ref = useRef<THREE.Group>(null);
  const ring2Ref = useRef<THREE.Group>(null);
  const ring3Ref = useRef<THREE.Group>(null);
  const smoothedRef = useRef(0);

  const coreMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x1ea2ff),
        emissive: new THREE.Color(0x3cc5ff),
        emissiveIntensity: 1.2,
        transparent: true,
        opacity: 0.35,
        roughness: 0.2,
        metalness: 0.0,
      }),
    [],
  );

  const wireMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x7fe5ff),
        wireframe: true,
        transparent: true,
        opacity: 0.9,
      }),
    [],
  );

  const ringMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x4ab8ff),
        emissive: new THREE.Color(0x1ea2ff),
        emissiveIntensity: 1.5,
        transparent: true,
        opacity: 0.85,
        roughness: 0.15,
        metalness: 0.3,
      }),
    [],
  );

  useFrame((_, dt) => {
    const target = speaking ? Math.min(1, Math.max(0, audioLevel)) : 0;
    const k = 1 - Math.exp(-dt * 16);
    smoothedRef.current += (target - smoothedRef.current) * k;
    const lvl = smoothedRef.current;

    const t = performance.now() / 1000;
    const idle = 0.5 + Math.sin(t * 1.6) * 0.05;
    const pulse = idle + lvl * 0.6;

    if (coreRef.current) {
      coreRef.current.scale.setScalar(0.6 + pulse * 0.25);
      const mat = coreRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.8 + lvl * 2.5 + Math.sin(t * 4) * 0.1;
      mat.opacity = 0.25 + lvl * 0.5;
    }
    if (innerRef.current) {
      innerRef.current.scale.setScalar(0.5 + pulse * 0.18);
      innerRef.current.rotation.y += dt * (0.5 + lvl * 2);
      innerRef.current.rotation.x += dt * (0.3 + lvl * 1.2);
    }
    if (ring1Ref.current) {
      ring1Ref.current.rotation.z += dt * (0.3 + lvl * 1.5);
      ring1Ref.current.rotation.y += dt * 0.08;
    }
    if (ring2Ref.current) {
      ring2Ref.current.rotation.x += dt * (0.4 + lvl * 1.2);
      ring2Ref.current.rotation.z -= dt * 0.12;
    }
    if (ring3Ref.current) {
      ring3Ref.current.rotation.y += dt * (0.5 + lvl * 1.8);
    }
  });

  return (
    <group>
      {/* Glowing translucent core */}
      <mesh ref={coreRef} material={coreMat}>
        <sphereGeometry args={[0.5, 32, 32]} />
      </mesh>

      {/* Inner wireframe icosahedron — spinning "AI core" */}
      <mesh ref={innerRef} material={wireMat}>
        <icosahedronGeometry args={[0.35, 1]} />
      </mesh>

      {/* Thin toroidal rings, tilted at different axes */}
      <group ref={ring1Ref}>
        <mesh material={ringMat}>
          <torusGeometry args={[0.85, 0.008, 16, 128]} />
        </mesh>
      </group>
      <group ref={ring2Ref} rotation={[Math.PI / 2.5, 0, 0]}>
        <mesh material={ringMat}>
          <torusGeometry args={[1.05, 0.006, 16, 128]} />
        </mesh>
      </group>
      <group ref={ring3Ref} rotation={[0, 0, Math.PI / 3]}>
        <mesh material={ringMat}>
          <torusGeometry args={[1.25, 0.005, 16, 128]} />
        </mesh>
      </group>

      {/* Orbiting nodes on outer ring */}
      <OrbitingNodes audioLevel={audioLevel} />
    </group>
  );
}

function OrbitingNodes({ audioLevel }: { audioLevel: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const count = 6;
  const radius = 1.4;

  const nodeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x7fe5ff),
        emissive: new THREE.Color(0x7fe5ff),
        emissiveIntensity: 2,
      }),
    [],
  );

  useFrame((_, dt) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += dt * (0.25 + audioLevel * 0.8);
    }
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: count }).map((_, i) => {
        const a = (i / count) * Math.PI * 2;
        return (
          <mesh key={i} position={[Math.cos(a) * radius, 0, Math.sin(a) * radius]} material={nodeMat}>
            <sphereGeometry args={[0.025, 16, 16]} />
          </mesh>
        );
      })}
    </group>
  );
}

function Scanlines() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, dt) => {
    const uTime = matRef.current?.uniforms.uTime;
    if (uTime) uTime.value += dt;
  });
  return (
    <mesh position={[0, 0, -1]}>
      <planeGeometry args={[6, 6]} />
      <shaderMaterial
        ref={matRef}
        transparent
        depthWrite={false}
        uniforms={uniforms}
        vertexShader={`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`}
        fragmentShader={`
          varying vec2 vUv;
          uniform float uTime;
          void main() {
            float scan = step(0.98, fract(vUv.y * 80.0 - uTime * 0.6));
            float sweep = smoothstep(0.0, 0.02, abs(fract(uTime * 0.08) - vUv.y));
            float grid = step(0.985, fract(vUv.x * 40.0)) + step(0.985, fract(vUv.y * 40.0));
            float a = scan * 0.05 + (1.0 - sweep) * 0.15 + grid * 0.02;
            gl_FragColor = vec4(0.24, 0.78, 1.0, a);
          }
        `}
      />
    </mesh>
  );
}

export function HolographicAvatar({ audioLevel, speaking }: AvatarProps) {
  return (
    <Canvas
      camera={{ position: [0, 0, 3.5], fov: 40 }}
      gl={{ alpha: true, antialias: true }}
      style={{ background: "transparent" }}
    >
      <ambientLight intensity={0.3} color={0x88ccff} />
      <pointLight position={[0, 2, 2]} intensity={3} color={0x55ddff} />
      <pointLight position={[2, -1, 1]} intensity={2} color={0x3388ff} />
      <pointLight position={[-2, -1, 1]} intensity={2} color={0x0066cc} />
      <Core audioLevel={audioLevel} speaking={speaking} />
      <Scanlines />
    </Canvas>
  );
}
