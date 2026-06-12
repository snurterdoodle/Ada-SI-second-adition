import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CoreMood } from './coreMood'
import { MOOD_COLORS, MOOD_PULSE, tierVisuals } from './coreMood'
import type { LevelTier } from '../../state/progression'

const fresnelVertex = `
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`

const fresnelFragment = `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  varying vec3 vNormal;
  varying vec3 vViewPosition;
  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.5);
    float pulse = 0.85 + 0.15 * sin(uTime * 2.0);
    float alpha = fresnel * uIntensity * pulse;
    gl_FragColor = vec4(uColor, alpha);
  }
`

function EnergyOrb({
  mood,
  tier,
  reducedMotion,
}: {
  mood: CoreMood
  tier: LevelTier
  reducedMotion: boolean
}) {
  const meshRef = useRef<THREE.Mesh>(null)
  const innerRef = useRef<THREE.Mesh>(null)
  const visuals = tierVisuals(tier)
  const colors = MOOD_COLORS[mood]
  const pulseSpeed = reducedMotion ? 0.5 : MOOD_PULSE[mood]

  const outerMaterial = useMemo(() => {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(colors.core) },
        uIntensity: { value: visuals.innerGlow },
        uTime: { value: 0 },
      },
      vertexShader: fresnelVertex,
      fragmentShader: fresnelFragment,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  }, [])

  const innerMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(colors.core),
        transparent: true,
        opacity: 0.9,
      }),
    [],
  )

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    outerMaterial.uniforms.uTime.value = t * pulseSpeed
    outerMaterial.uniforms.uColor.value.set(colors.core)
    outerMaterial.uniforms.uIntensity.value = visuals.innerGlow
    innerMaterial.color.set(colors.core)

    if (meshRef.current) {
      const breathe = 1 + Math.sin(t * pulseSpeed) * 0.04
      meshRef.current.scale.setScalar(visuals.scale * breathe)
      if (!reducedMotion) {
        meshRef.current.rotation.y = t * 0.15
        meshRef.current.rotation.x = Math.sin(t * 0.3) * 0.1
      }
    }
    if (innerRef.current) {
      const innerBreathe = 0.35 + Math.sin(t * pulseSpeed * 1.3) * 0.05
      innerRef.current.scale.setScalar(innerBreathe)
    }
  })

  return (
    <group>
      <mesh ref={meshRef}>
        <icosahedronGeometry args={[1, 4]} />
        <primitive object={outerMaterial} attach="material" />
      </mesh>
      <mesh ref={innerRef}>
        <sphereGeometry args={[0.28, 32, 32]} />
        <primitive object={innerMaterial} attach="material" />
      </mesh>
    </group>
  )
}

function ParticleField({
  count,
  mood,
  tier,
  reducedMotion,
}: {
  count: number
  mood: CoreMood
  tier: LevelTier
  reducedMotion: boolean
}) {
  const ref = useRef<THREE.Points>(null)
  const colors = MOOD_COLORS[mood]
  const pulseSpeed = reducedMotion ? 0.3 : MOOD_PULSE[mood]

  const { positions } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 1.2 + Math.random() * (tier === 'ascended' ? 1.8 : 1.2)
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)
    }
    return { positions }
  }, [count, tier])

  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion) return
    const t = clock.getElapsedTime()
    ref.current.rotation.y = t * 0.08 * pulseSpeed
    ref.current.rotation.x = Math.sin(t * 0.2) * 0.05
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={colors.particle}
        size={tier === 'spark' ? 0.015 : 0.02}
        transparent
        opacity={0.7}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function HoloRing({
  radius,
  tilt,
  mood,
  speed,
  reducedMotion,
}: {
  radius: number
  tilt: number
  mood: CoreMood
  speed: number
  reducedMotion: boolean
}) {
  const ref = useRef<THREE.Mesh>(null)
  const colors = MOOD_COLORS[mood]

  useFrame(({ clock }) => {
    if (!ref.current || reducedMotion) return
    ref.current.rotation.z = clock.getElapsedTime() * speed
  })

  return (
    <mesh ref={ref} rotation={[tilt, 0, 0]}>
      <torusGeometry args={[radius, 0.008, 8, 64]} />
      <meshBasicMaterial
        color={colors.ring}
        transparent
        opacity={0.55}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  )
}

type AiCoreSceneProps = {
  mood: CoreMood
  tier: LevelTier
  reducedMotion?: boolean
}

export function AiCoreScene({ mood, tier, reducedMotion = false }: AiCoreSceneProps) {
  const visuals = tierVisuals(tier)

  return (
    <>
      <ambientLight intensity={0.15} />
      <pointLight position={[0, 0, 2]} intensity={1.2} color={MOOD_COLORS[mood].core} />
      <EnergyOrb mood={mood} tier={tier} reducedMotion={reducedMotion} />
      <ParticleField
        count={reducedMotion ? Math.floor(visuals.particleCount * 0.3) : visuals.particleCount}
        mood={mood}
        tier={tier}
        reducedMotion={reducedMotion}
      />
      {visuals.ringCount >= 1 && (
        <HoloRing radius={1.35} tilt={Math.PI / 3} mood={mood} speed={0.4} reducedMotion={reducedMotion} />
      )}
      {visuals.ringCount >= 2 && (
        <HoloRing radius={1.55} tilt={Math.PI / 4.5} mood={mood} speed={-0.3} reducedMotion={reducedMotion} />
      )}
      {visuals.ringCount >= 3 && (
        <HoloRing radius={1.75} tilt={Math.PI / 2.2} mood={mood} speed={0.2} reducedMotion={reducedMotion} />
      )}
    </>
  )
}
