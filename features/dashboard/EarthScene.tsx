"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { PerspectiveCamera, useTexture } from "@react-three/drei";
import { memo, useMemo, useRef } from "react";
import * as THREE from "three";

type EarthSceneProps = {
  isRunning?: boolean;
  anomalyDetected?: boolean;
  className?: string;
};

type OrbitConfig = {
  id: string;
  radius: number;
  inclination: number;
  raan: number;
  color: string;
  opacity: number;
};

type SatelliteConfig = OrbitConfig & {
  label: string;
  orbitClass: "GEO" | "MEO" | "IGSO";
  speed: number;
  phase: number;
  size: number;
  deviation: number;
  glowColor: string;
  bodyColor: string;
  panelColor: string;
};

const SUN_DIRECTION = new THREE.Vector3(4.5, 1.75, 3.25).normalize();
const TRAIL_POINTS = 30;
const ORBIT_SEGMENTS = 360;

const SATELLITE_CONFIGS: SatelliteConfig[] = [
  {
    id: "geo-1",
    label: "GEO-1",
    orbitClass: "GEO",
    radius: 2.55,
    inclination: 4,
    raan: 0,
    color: "#93c5fd",
    opacity: 0.36,
    speed: 0.055,
    phase: 0.35,
    size: 0.052,
    deviation: 0.034,
    glowColor: "#7dd3fc",
    bodyColor: "#111827",
    panelColor: "#1e3a8a",
  },
  {
    id: "meo-2",
    label: "MEO-2",
    orbitClass: "MEO",
    radius: 1.76,
    inclination: 55,
    raan: 24,
    color: "#67e8f9",
    opacity: 0.42,
    speed: 0.17,
    phase: 1.65,
    size: 0.048,
    deviation: 0.026,
    glowColor: "#22d3ee",
    bodyColor: "#0f172a",
    panelColor: "#155e75",
  },
  {
    id: "meo-3",
    label: "MEO-3",
    orbitClass: "MEO",
    radius: 1.93,
    inclination: 58,
    raan: 136,
    color: "#bae6fd",
    opacity: 0.34,
    speed: 0.145,
    phase: 3.18,
    size: 0.045,
    deviation: 0.028,
    glowColor: "#bae6fd",
    bodyColor: "#111827",
    panelColor: "#0e7490",
  },
  {
    id: "igso-4",
    label: "IGSO-4",
    orbitClass: "IGSO",
    radius: 2.18,
    inclination: 33,
    raan: 78,
    color: "#a5f3fc",
    opacity: 0.32,
    speed: 0.105,
    phase: 4.6,
    size: 0.05,
    deviation: 0.032,
    glowColor: "#38bdf8",
    bodyColor: "#111827",
    panelColor: "#164e63",
  },
  {
    id: "meo-5",
    label: "MEO-5",
    orbitClass: "MEO",
    radius: 1.58,
    inclination: 64,
    raan: 224,
    color: "#7dd3fc",
    opacity: 0.3,
    speed: 0.19,
    phase: 5.45,
    size: 0.042,
    deviation: 0.024,
    glowColor: "#67e8f9",
    bodyColor: "#0b1120",
    panelColor: "#0f766e",
  },
  {
    id: "geo-6",
    label: "GEO-6",
    orbitClass: "GEO",
    radius: 2.72,
    inclination: 8,
    raan: 162,
    color: "#dbeafe",
    opacity: 0.26,
    speed: 0.047,
    phase: 2.54,
    size: 0.052,
    deviation: 0.03,
    glowColor: "#93c5fd",
    bodyColor: "#111827",
    panelColor: "#1d4ed8",
  },
];

export const EarthScene = memo(function EarthScene({ isRunning, anomalyDetected, className }: EarthSceneProps) {
  return (
    <div className={["h-full w-full", className].filter(Boolean).join(" ")}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        camera={{ position: [0.4, 1.15, 4.05], fov: 42, near: 0.1, far: 90 }}
      >
        <color attach="background" args={["#01030a"]} />
        <fog attach="fog" args={["#01030a", 9, 28]} />

        <MissionStarfield />
        <ambientLight intensity={0.12} color="#dbeafe" />
        <hemisphereLight args={["#dbeafe", "#020617", 0.16]} />
        <directionalLight
          castShadow
          intensity={2.35}
          position={[4.5, 1.75, 3.25]}
          color="#fff7ed"
        />

        <EarthSystem />
        <OrbitNetwork anomalyDetected={!!anomalyDetected} />
        <SatelliteConstellation isRunning={!!isRunning} anomalyDetected={!!anomalyDetected} />
        <CinematicCameraRig isRunning={!!isRunning} anomalyDetected={!!anomalyDetected} />

        <EffectComposer multisampling={0}>
          <Bloom
            intensity={anomalyDetected ? 0.42 : 0.28}
            luminanceThreshold={0.22}
            luminanceSmoothing={0.82}
            mipmapBlur
          />
        </EffectComposer>
      </Canvas>
    </div>
  );
});

function EarthSystem() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += dt * 0.012;
  });

  return (
    <group ref={groupRef} rotation={[0, -0.48, 0]}>
      <EarthSurface />
      <CityLights />
      <Atmosphere />
    </group>
  );
}

function EarthSurface() {
  const [day, normal] = useTexture([
    "/textures/earth_day_2048.jpg",
    "/textures/earth_normal_2048.jpg",
  ]);

  const [configuredDay, configuredNormal] = useMemo(() => {
    const nextDay = day.clone();
    nextDay.colorSpace = THREE.SRGBColorSpace;
    nextDay.anisotropy = 12;

    const nextNormal = normal.clone();
    nextNormal.anisotropy = 12;

    return [nextDay, nextNormal] as const;
  }, [day, normal]);

  return (
    <mesh castShadow receiveShadow>
      <sphereGeometry args={[1, 128, 128]} />
      <meshStandardMaterial
        map={configuredDay}
        normalMap={configuredNormal}
        normalScale={new THREE.Vector2(0.36, 0.36)}
        roughness={0.74}
        metalness={0}
        envMapIntensity={0.14}
      />
    </mesh>
  );
}

function CityLights() {
  const lightsTexture = useMemo(() => createCityLightsTexture(), []);
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uLights: { value: lightsTexture },
          uSunDirection: { value: SUN_DIRECTION },
        },
        vertexShader: `
          varying vec2 vUv;
          varying vec3 vWorldNormal;

          void main() {
            vUv = uv;
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D uLights;
          uniform vec3 uSunDirection;
          varying vec2 vUv;
          varying vec3 vWorldNormal;

          void main() {
            vec4 lights = texture2D(uLights, vUv);
            float sun = dot(normalize(vWorldNormal), normalize(uSunDirection));
            float night = smoothstep(0.08, -0.24, sun);
            float terminator = smoothstep(0.16, -0.18, sun);
            float alpha = lights.a * night * 0.96;
            vec3 color = mix(vec3(1.0, 0.62, 0.26), vec3(0.56, 0.86, 1.0), lights.b * 0.35);
            gl_FragColor = vec4(color * lights.r * (1.25 + terminator * 0.55), alpha);
          }
        `,
      }),
    [lightsTexture],
  );

  return (
    <mesh scale={1.003} material={material}>
      <sphereGeometry args={[1, 128, 128]} />
    </mesh>
  );
}

function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uColor: { value: new THREE.Color("#7dd3fc") },
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vWorldPosition;

          void main() {
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * viewMatrix * worldPosition;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vWorldPosition;

          void main() {
            vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
            float rim = pow(1.0 - max(dot(viewDirection, normalize(vNormal)), 0.0), 3.2);
            gl_FragColor = vec4(uColor, rim * 0.42);
          }
        `,
      }),
    [],
  );

  return (
    <group>
      <mesh scale={1.055} material={material}>
        <sphereGeometry args={[1, 128, 128]} />
      </mesh>
      <mesh scale={1.012}>
        <sphereGeometry args={[1, 96, 96]} />
        <meshBasicMaterial
          color="#7dd3fc"
          transparent
          opacity={0.025}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function OrbitNetwork({ anomalyDetected }: { anomalyDetected: boolean }) {
  return (
    <group>
      {SATELLITE_CONFIGS.map((orbit) => (
        <OrbitPath key={orbit.id} orbit={orbit} anomalyDetected={anomalyDetected} />
      ))}
    </group>
  );
}

function OrbitPath({ orbit, anomalyDetected }: { orbit: OrbitConfig; anomalyDetected: boolean }) {
  const path = useMemo(() => createOrbitLine(orbit.radius, orbit.color, orbit.opacity), [orbit]);
  const halo = useMemo(() => createOrbitLine(orbit.radius, orbit.color, orbit.opacity * 0.42), [orbit]);
  const groupRotation = useOrbitRotation(orbit);

  useFrame(({ clock }, dt) => {
    const pulse = anomalyDetected ? 0.5 + Math.sin(clock.elapsedTime * 2.1 + orbit.radius) * 0.5 : 0;
    const targetOpacity = orbit.opacity + (anomalyDetected ? 0.2 + pulse * 0.16 : 0);
    const targetHaloOpacity = orbit.opacity * (anomalyDetected ? 0.72 + pulse * 0.18 : 0.36);
    const color = anomalyDetected ? "#fb923c" : orbit.color;

    updateLineMaterial(path, color, targetOpacity, dt);
    updateLineMaterial(halo, color, targetHaloOpacity, dt);
  });

  return (
    <group rotation={groupRotation}>
      <primitive object={halo} />
      <primitive object={path} />
    </group>
  );
}

function SatelliteConstellation({
  isRunning,
  anomalyDetected,
}: {
  isRunning: boolean;
  anomalyDetected: boolean;
}) {
  return (
    <group>
      {SATELLITE_CONFIGS.map((config) => (
        <Satellite
          key={config.id}
          config={config}
          isRunning={isRunning}
          anomalyDetected={anomalyDetected}
        />
      ))}
    </group>
  );
}

function Satellite({
  config,
  isRunning,
  anomalyDetected,
}: {
  config: SatelliteConfig;
  isRunning: boolean;
  anomalyDetected: boolean;
}) {
  const bodyRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const phaseRef = useRef(config.phase);
  const deviationRef = useRef(0);
  const trailGeometryRef = useRef<THREE.BufferGeometry>(null);
  const trailMaterialRef = useRef<THREE.LineBasicMaterial>(null);
  const trailPositions = useMemo(() => new Float32Array(TRAIL_POINTS * 3), []);
  const trailColors = useMemo(() => createTrailColors(config.glowColor), [config.glowColor]);
  const groupRotation = useOrbitRotation(config);

  useFrame(({ clock }, dt) => {
    phaseRef.current += dt * config.speed * (isRunning ? 1.18 : 1);
    deviationRef.current = THREE.MathUtils.damp(
      deviationRef.current,
      anomalyDetected ? 1 : 0,
      anomalyDetected ? 1.45 : 0.95,
      dt,
    );

    const t = phaseRef.current;
    const deviation = deviationRef.current;
    const radiusOffset = Math.sin(t * 1.7 + config.phase) * config.deviation * deviation;
    const crossTrack = Math.sin(t * 2.25 + config.phase * 0.7) * config.deviation * 0.64 * deviation;
    const radius = config.radius + radiusOffset;
    const position = new THREE.Vector3(Math.cos(t) * radius, crossTrack, Math.sin(t) * radius);
    const tangent = new THREE.Vector3(-Math.sin(t), 0, Math.cos(t)).normalize();

    if (bodyRef.current) {
      bodyRef.current.position.copy(position);
      bodyRef.current.lookAt(position.clone().add(tangent));
      bodyRef.current.rotation.z += Math.sin(t * 0.8 + config.phase) * 0.002;
    }

    if (glowRef.current) {
      const pulse = anomalyDetected ? 0.34 + Math.sin(clock.elapsedTime * 4.2 + config.phase) * 0.1 : 0;
      glowRef.current.scale.setScalar(1.45 + pulse);
    }

    updateTrail(trailPositions, t, config, deviation);
    const positionAttribute = trailGeometryRef.current?.getAttribute("position");
    if (positionAttribute) {
      positionAttribute.needsUpdate = true;
    }

    const material = trailMaterialRef.current;
    if (material) {
      material.opacity = THREE.MathUtils.damp(material.opacity, anomalyDetected ? 0.74 : 0.48, 1.4, dt);
      material.color.set(anomalyDetected ? "#fb923c" : config.glowColor);
    }
  });

  return (
    <group rotation={groupRotation}>
      <line>
        <bufferGeometry ref={trailGeometryRef}>
          <bufferAttribute attach="attributes-position" args={[trailPositions, 3]} />
          <bufferAttribute attach="attributes-color" args={[trailColors, 3]} />
        </bufferGeometry>
        <lineBasicMaterial
          ref={trailMaterialRef}
          color={config.glowColor}
          vertexColors
          transparent
          opacity={0.48}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </line>
      <group ref={bodyRef}>
        <mesh castShadow>
          <boxGeometry args={[config.size * 1.42, config.size * 0.78, config.size * 0.78]} />
          <meshStandardMaterial
            color={config.bodyColor}
            emissive={config.glowColor}
            emissiveIntensity={anomalyDetected ? 0.72 : 0.32}
            roughness={0.28}
            metalness={0.72}
          />
        </mesh>

        <mesh position={[config.size * 1.38, 0, 0]}>
          <boxGeometry args={[config.size * 1.7, config.size * 0.12, config.size * 0.84]} />
          <meshStandardMaterial
            color={config.panelColor}
            emissive={config.glowColor}
            emissiveIntensity={anomalyDetected ? 0.32 : 0.18}
            roughness={0.46}
            metalness={0.54}
          />
        </mesh>
        <mesh position={[-config.size * 1.38, 0, 0]}>
          <boxGeometry args={[config.size * 1.7, config.size * 0.12, config.size * 0.84]} />
          <meshStandardMaterial
            color={config.panelColor}
            emissive={config.glowColor}
            emissiveIntensity={anomalyDetected ? 0.32 : 0.18}
            roughness={0.46}
            metalness={0.54}
          />
        </mesh>

        <mesh position={[0, config.size * 0.72, 0]}>
          <cylinderGeometry args={[config.size * 0.045, config.size * 0.045, config.size * 1.05, 10]} />
          <meshStandardMaterial
            color="#e0f2fe"
            emissive={config.glowColor}
            emissiveIntensity={anomalyDetected ? 0.44 : 0.16}
            roughness={0.34}
            metalness={0.5}
          />
        </mesh>

        <mesh ref={glowRef}>
          <sphereGeometry args={[config.size * 1.08, 18, 18]} />
          <meshBasicMaterial
            color={config.glowColor}
            transparent
            opacity={anomalyDetected ? 0.28 : 0.12}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}

function MissionStarfield() {
  const starsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const count = 950;
    const next = new Float32Array(count * 3);

    for (let i = 0; i < count; i += 1) {
      const i3 = i * 3;
      const t = i / count;
      const theta = i * 2.399963229728653;
      const y = 1 - 2 * t;
      const planarRadius = Math.sqrt(1 - y * y);
      const shellRadius = 15 + (((i * 37) % 101) / 101) * 18;

      next[i3] = Math.cos(theta) * planarRadius * shellRadius;
      next[i3 + 1] = y * shellRadius;
      next[i3 + 2] = Math.sin(theta) * planarRadius * shellRadius;
    }

    return next;
  }, []);

  useFrame((_, dt) => {
    if (!starsRef.current) return;
    starsRef.current.rotation.y += dt * 0.0025;
    starsRef.current.rotation.x += dt * 0.0008;
  });

  return (
    <points ref={starsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color="#dbeafe"
        size={0.032}
        sizeAttenuation
        transparent
        opacity={0.62}
        depthWrite={false}
      />
    </points>
  );
}

function CinematicCameraRig({
  isRunning,
  anomalyDetected,
}: {
  isRunning: boolean;
  anomalyDetected: boolean;
}) {
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const tRef = useRef(0);

  useFrame((_, dt) => {
    const camera = cameraRef.current;
    if (!camera) return;

    tRef.current += dt * 0.035;
    const t = tRef.current;
    const targetPosition = new THREE.Vector3(
      0.34 + Math.sin(t * 0.85) * 0.2,
      1.12 + Math.sin(t * 0.62) * 0.08,
      4.06 + Math.cos(t * 0.7) * 0.18,
    );

    camera.position.lerp(targetPosition, 0.025);
    camera.lookAt(0, 0.04, 0);
    camera.fov = THREE.MathUtils.damp(camera.fov, anomalyDetected ? 41.2 : isRunning ? 40.7 : 42, 1.15, dt);
    camera.updateProjectionMatrix();
  });

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      position={[0.4, 1.15, 4.05]}
      fov={42}
      near={0.1}
      far={90}
    />
  );
}

function useOrbitRotation(orbit: Pick<OrbitConfig, "inclination" | "raan">) {
  return useMemo(
    () => [THREE.MathUtils.degToRad(orbit.inclination), 0, THREE.MathUtils.degToRad(orbit.raan)] as [number, number, number],
    [orbit.inclination, orbit.raan],
  );
}

function createOrbitLine(radius: number, color: string, opacity: number) {
  const positions = new Float32Array(ORBIT_SEGMENTS * 3);

  for (let i = 0; i < ORBIT_SEGMENTS; i += 1) {
    const t = (i / ORBIT_SEGMENTS) * Math.PI * 2;
    const i3 = i * 3;
    positions[i3] = Math.cos(t) * radius;
    positions[i3 + 1] = 0;
    positions[i3 + 2] = Math.sin(t) * radius;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.LineLoop(geometry, material);
}

function updateLineMaterial(line: THREE.LineLoop, color: string, targetOpacity: number, dt: number) {
  const material = line.material;
  if (Array.isArray(material)) return;

  const lineMaterial = material as THREE.LineBasicMaterial;
  lineMaterial.opacity = THREE.MathUtils.damp(lineMaterial.opacity, targetOpacity, 1.6, dt);
  lineMaterial.color.lerp(new THREE.Color(color), 0.05);
}

function createTrailColors(color: string) {
  const colors = new Float32Array(TRAIL_POINTS * 3);
  const base = new THREE.Color(color);

  for (let i = 0; i < TRAIL_POINTS; i += 1) {
    const fade = 1 - i / (TRAIL_POINTS - 1);
    const i3 = i * 3;
    colors[i3] = base.r * fade;
    colors[i3 + 1] = base.g * fade;
    colors[i3 + 2] = base.b * fade;
  }

  return colors;
}

function updateTrail(
  positions: Float32Array,
  currentT: number,
  config: SatelliteConfig,
  deviation: number,
) {
  for (let i = 0; i < TRAIL_POINTS; i += 1) {
    const trailAge = i / (TRAIL_POINTS - 1);
    const t = currentT - trailAge * 0.72;
    const radiusOffset = Math.sin(t * 1.7 + config.phase) * config.deviation * deviation;
    const crossTrack = Math.sin(t * 2.25 + config.phase * 0.7) * config.deviation * 0.64 * deviation;
    const radius = config.radius + radiusOffset;
    const i3 = i * 3;

    positions[i3] = Math.cos(t) * radius;
    positions[i3 + 1] = crossTrack;
    positions[i3 + 2] = Math.sin(t) * radius;
  }
}

function createCityLightsTexture() {
  const width = 512;
  const height = 256;
  const data = new Uint8Array(width * height * 4);
  const cities = [
    { lat: 40.7, lon: -74.0, intensity: 1.0 },
    { lat: 41.9, lon: -87.6, intensity: 0.82 },
    { lat: 29.8, lon: -95.4, intensity: 0.74 },
    { lat: 34.0, lon: -118.2, intensity: 0.9 },
    { lat: 37.8, lon: -122.4, intensity: 0.75 },
    { lat: 19.4, lon: -99.1, intensity: 0.75 },
    { lat: 4.7, lon: -74.1, intensity: 0.62 },
    { lat: -12.0, lon: -77.0, intensity: 0.56 },
    { lat: -23.5, lon: -46.6, intensity: 0.72 },
    { lat: -34.6, lon: -58.4, intensity: 0.62 },
    { lat: 51.5, lon: -0.1, intensity: 0.96 },
    { lat: 48.9, lon: 2.3, intensity: 0.85 },
    { lat: 52.5, lon: 13.4, intensity: 0.78 },
    { lat: 41.9, lon: 12.5, intensity: 0.68 },
    { lat: 40.4, lon: -3.7, intensity: 0.62 },
    { lat: 55.8, lon: 37.6, intensity: 0.82 },
    { lat: 30.0, lon: 31.2, intensity: 0.62 },
    { lat: 25.2, lon: 55.3, intensity: 0.66 },
    { lat: 28.6, lon: 77.2, intensity: 1.0 },
    { lat: 19.1, lon: 72.9, intensity: 0.92 },
    { lat: 13.1, lon: 80.3, intensity: 0.72 },
    { lat: 22.6, lon: 88.4, intensity: 0.75 },
    { lat: 39.9, lon: 116.4, intensity: 0.92 },
    { lat: 31.2, lon: 121.5, intensity: 0.95 },
    { lat: 35.7, lon: 139.7, intensity: 0.96 },
    { lat: 37.6, lon: 127.0, intensity: 0.82 },
    { lat: 1.35, lon: 103.8, intensity: 0.74 },
    { lat: -6.2, lon: 106.8, intensity: 0.7 },
    { lat: -33.9, lon: 151.2, intensity: 0.58 },
    { lat: -26.2, lon: 28.0, intensity: 0.54 },
  ];

  for (const city of cities) {
    addCityGlow(data, width, height, city.lat, city.lon, city.intensity);
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return texture;
}

function addCityGlow(
  data: Uint8Array,
  width: number,
  height: number,
  lat: number,
  lon: number,
  intensity: number,
) {
  const cx = ((lon + 180) / 360) * width;
  const cy = ((90 - lat) / 180) * height;
  const radius = 9 + intensity * 13;

  for (let y = Math.max(0, Math.floor(cy - radius)); y < Math.min(height, Math.ceil(cy + radius)); y += 1) {
    for (let x = Math.max(0, Math.floor(cx - radius)); x < Math.min(width, Math.ceil(cx + radius)); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const falloff = Math.max(0, 1 - dist / radius);
      const signal = Math.pow(falloff, 2.15) * intensity;
      const index = (y * width + x) * 4;
      const current = data[index] / 255;
      const next = Math.min(1, current + signal);

      data[index] = Math.round(next * 255);
      data[index + 1] = Math.round(next * 206);
      data[index + 2] = Math.round((0.32 + intensity * 0.28) * 255);
      data[index + 3] = Math.round(Math.min(1, next) * 255);
    }
  }
}
