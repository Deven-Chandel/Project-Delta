/** GLSL for the Earth, its atmosphere, the star field and the arc pulses. */

export const earthVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export const earthFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D waterMap;
  uniform vec3 sunDir;
  uniform float cream;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;

  void main() {
    vec3 n = normalize(vNormalW);
    vec3 viewDir = normalize(cameraPosition - vPosW);
    float cosSun = dot(n, sunDir);

    // Soft terminator: civil twilight is ~6° wide, so blend over roughly that band.
    float dayMix = smoothstep(-0.10, 0.10, cosSun);

    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;

    float diffuse = clamp(cosSun * 1.15 + 0.12, 0.0, 1.0);
    vec3 dayLit = day * (0.08 + 0.9 * diffuse);

    // City lights: warm sodium tint, faded out as the sun comes up.
    vec3 lights = pow(night, vec3(1.25)) * vec3(1.0, 0.72, 0.42) * 2.4;
    vec3 nightSide = day * 0.035 + lights;
    vec3 color = mix(nightSide, dayLit, dayMix);

    // Ocean glint.
    float water = texture2D(waterMap, vUv).r;
    vec3 h = normalize(sunDir + viewDir);
    float spec = pow(max(dot(n, h), 0.0), 120.0) * water * 0.38 * dayMix * smoothstep(0.0, 0.35, dot(n, viewDir));
    color += vec3(1.0, 0.9, 0.75) * spec;


    // Atmospheric rim, brighter on the day side.
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
    vec3 rimColor = mix(vec3(0.31, 0.62, 1.0), vec3(0.95, 0.62, 0.32), cream);
    color += rimColor * rim * (0.03 + 0.65 * smoothstep(-0.2, 0.5, cosSun));

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const atmosphereVertex = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vNormalW;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const atmosphereFragment = /* glsl */ `
  uniform vec3 sunDir;
  uniform vec3 glowColor;
  uniform float strength;
  varying vec3 vNormalV;
  varying vec3 vNormalW;
  void main() {
    float intensity = pow(max(0.0, 0.68 - dot(vNormalV, vec3(0.0, 0.0, 1.0))), 3.2);
    float lit = 0.12 + 0.88 * smoothstep(-0.3, 0.5, dot(normalize(vNormalW), sunDir));
    gl_FragColor = vec4(glowColor, clamp(intensity * lit * strength, 0.0, 1.0));
  }
`;

export const starsVertex = /* glsl */ `
  attribute float size;
  attribute float phase;
  uniform float time;
  uniform float pixelRatio;
  varying float vAlpha;
  void main() {
    vAlpha = 0.55 + 0.45 * sin(time * 0.8 + phase);
    gl_PointSize = size * pixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const starsFragment = /* glsl */ `
  uniform float opacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(0.85, 0.9, 1.0), a * vAlpha * opacity);
  }
`;

/** Lines whose `progress` attribute (0→1 along the arc) drives a travelling pulse. */
export const arcVertex = /* glsl */ `
  attribute float progress;
  varying float vProgress;
  void main() {
    vProgress = progress;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const arcFragment = /* glsl */ `
  uniform vec3 color;
  uniform float time;
  uniform float opacity;
  uniform float offset;
  varying float vProgress;
  void main() {
    float head = fract(time * 0.35 + offset);
    float d = vProgress - head;
    float pulse = exp(-pow(d / 0.06, 2.0)) * step(d, 0.0) + exp(-pow(d / 0.012, 2.0));
    float base = 0.22;
    float fade = smoothstep(0.0, 0.06, vProgress) * smoothstep(1.0, 0.94, vProgress);
    gl_FragColor = vec4(color, (base + pulse * 1.4) * opacity * fade);
  }
`;
