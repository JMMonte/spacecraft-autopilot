// Based on https://www.shadertoy.com/view/4sX3Rs
uniform float iTime;
uniform vec2 lensPosition;
uniform vec2 iResolution;
uniform vec3 colorGain;
uniform float starPoints;
uniform float glareSize;
uniform float flareSize;
uniform float flareSpeed;
uniform float flareShape;
uniform float haloScale;
uniform float opacity;
uniform bool animated;
uniform bool anamorphic;
uniform bool enabled;
uniform bool secondaryGhosts;
uniform bool starBurst;
uniform float ghostScale;
uniform bool aditionalStreaks;
varying vec2 vUv;

float uDispersal = 0.3;
float uHaloWidth = 0.6;
float uDistortion = 1.5;
float uBrightDark = 0.5;

float rand(float n) {
    return fract(sin(n) * 43758.5453123);
}

float noise(float p) {
    float fl = floor(p);
    float fc = fract(p);
    return mix(rand(fl), rand(fl + 1.0), fc);
}

vec3 hsv2rgb(vec3 c) {
    vec4 k = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
    return c.z * mix(k.xxx, clamp(p - k.xxx, 0.0, 1.0), c.y);
}

float saturate2(float x) {
    return clamp(x, 0., 1.);
}

vec2 rotateUV(vec2 uv, float rotation) {
    return vec2(cos(rotation) * uv.x + sin(rotation) * uv.y, cos(rotation) * uv.y - sin(rotation) * uv.x);
}

vec3 drawflare(vec2 p, float intensity, float rnd, float speed, int id) {
    float flarehueoffset = (1. / 32.) * float(id) * 0.1;
    float lingrad = distance(vec2(0.), p);
    float expgrad = 1. / exp(lingrad * (fract(rnd) * 0.66 + 0.33));
    vec3 colgrad = hsv2rgb(vec3(fract((expgrad * 8.) + speed * flareSpeed + flarehueoffset), pow(1. - abs(expgrad * 2. - 1.), 0.45), 20.0 * expgrad * intensity));

    float internalStarPoints;

    if(anamorphic) {
        internalStarPoints = 1.0;
    } else {
        internalStarPoints = starPoints;
    }

    float blades = length(p * flareShape * sin(internalStarPoints * atan(p.x, p.y)));

    float comp = pow(1. - saturate2(blades), (anamorphic ? 100. : 12.));
    comp += saturate2(expgrad - 0.9) * 3.;
    comp = pow(comp * expgrad, 8. + (1. - intensity) * 5.);

    if(flareSpeed > 0.0) {
        return vec3(comp) * colgrad;
    } else {
        return vec3(comp) * flareSize * 15.;
    }
}

float glare(vec2 uv, vec2 pos, float size) {
    vec2 main;

    if(animated) {
        main = rotateUV(uv - pos, iTime * 0.1);
    } else {
        main = uv - pos;
    }

    float ang = atan(main.y, main.x) * (anamorphic ? 1.0 : starPoints);
    float dist = length(main);
    dist = pow(dist, .9);

    float f0 = 1.0 / (length(uv - pos) * (1.0 / size * 16.0) + .2);

    return f0 + f0 * (sin((ang)) * .2 + .3);
}

float sdHex(vec2 p) {
    p = abs(p);
    vec2 q = vec2(p.x * 2.0 * 0.5773503, p.y + p.x * 0.5773503);
    return dot(step(q.xy, q.yx), 1.0 - q.yx);
}

float fpow(float x, float k) {
    return x > k ? pow((x - k) / (1.0 - k), 2.0) : 0.0;
}

vec3 renderhex(vec2 uv, vec2 p, float s, vec3 col) {
    uv -= p;
    if(abs(uv.x) < 0.2 * s && abs(uv.y) < 0.2 * s) {
        return mix(vec3(0), mix(vec3(0), col, 0.1 + fpow(length(uv / s), 0.1) * 10.0), smoothstep(0.0, 0.1, sdHex(uv * 20.0 / s)));
    }
    return vec3(0);
}

vec3 LensFlare(vec2 uv, vec2 pos) {
    vec2 main = uv - pos;
    vec2 uvd = uv * (length(uv));

    float ang = atan(main.x, main.y);

    float f0 = .3 / (length(uv - pos) * 16.0 + 1.0);

    f0 = f0 * (sin(noise(sin(ang * 3.9 - (animated ? iTime : 0.0) * 0.3) * starPoints)) * .2);

    float f1 = max(0.01 - pow(length(uv + 1.2 * pos), 1.9), .0) * 7.0;

    float f2 = max(.9 / (10.0 + 32.0 * pow(length(uvd + 0.99 * pos), 2.0)), .0) * 0.35;
    float f22 = max(.9 / (11.0 + 32.0 * pow(length(uvd + 0.85 * pos), 2.0)), .0) * 0.23;
    float f23 = max(.9 / (12.0 + 32.0 * pow(length(uvd + 0.95 * pos), 2.0)), .0) * 0.6;

    vec2 uvx = mix(uv, uvd, 0.1);

    float f4 = max(0.01 - pow(length(uvx + 0.4 * pos), 2.9), .0) * 4.02;
    float f42 = max(0.0 - pow(length(uvx + 0.45 * pos), 2.9), .0) * 4.1;
    float f43 = max(0.01 - pow(length(uvx + 0.5 * pos), 2.9), .0) * 4.6;

    uvx = mix(uv, uvd, -.4);

    float f5 = max(0.01 - pow(length(uvx + 0.1 * pos), 5.5), .0) * 2.0;
    float f52 = max(0.01 - pow(length(uvx + 0.2 * pos), 5.5), .0) * 2.0;
    float f53 = max(0.01 - pow(length(uvx + 0.1 * pos), 5.5), .0) * 2.0;

    uvx = mix(uv, uvd, 2.1);

    float f6 = max(0.01 - pow(length(uvx - 0.3 * pos), 1.61), .0) * 3.159;
    float f62 = max(0.01 - pow(length(uvx - 0.325 * pos), 1.614), .0) * 3.14;
    float f63 = max(0.01 - pow(length(uvx - 0.389 * pos), 1.623), .0) * 3.12;

    vec3 c = vec3(glare(uv, pos, glareSize));

    vec2 prot;

    if(animated) {
        prot = rotateUV(uv - pos, (iTime * 0.1));
    } else if(anamorphic) {
        prot = rotateUV(uv - pos, 1.570796);
    } else {
        prot = uv - pos;
    }

    c += drawflare(prot, (anamorphic ? flareSize * 10. : flareSize), 0.1, iTime, 1);

    c.r += f1 + f2 + f4 + f5 + f6;
    c.g += f1 + f22 + f42 + f52 + f62;
    c.b += f1 + f23 + f43 + f53 + f63;
    c = c * 1.3 * vec3(length(uvd) + .09);
    c += vec3(f0);

    return c;
}

float rnd(vec2 p) {
    float f = fract(sin(dot(p, vec2(12.1234, 72.8392)) * 45123.2));
    return f;
}

float rnd(float w) {
    float f = fract(sin(w) * 1000.);
    return f;
}

float regShape(vec2 p, int N) {
    float f;

    float a = atan(p.x, p.y) + .2;
    float b = 6.28319 / float(N);
    f = smoothstep(.5, .51, cos(floor(.5 + a / b) * b - a) * length(p.xy) * 2.0 - ghostScale);

    return f;
}

vec3 circle(vec2 p, float size, float decay, vec3 color, vec3 color2, float dist, vec2 mouse) {
    float l = length(p + mouse * (dist * 2.)) + size / 2.;
    float l2 = length(p + mouse * (dist * 4.)) + size / 3.;

    float c = max(0.04 - pow(length(p + mouse * dist), size * ghostScale), 0.0) * 10.;
    float c1 = max(0.001 - pow(l - 0.3, 1. / 40.) + sin(l * 20.), 0.0) * 3.;
    float c2 = max(0.09 / pow(length(p - mouse * dist / .5) * 1., .95), 0.0) / 20.;
    float s = max(0.02 - pow(regShape(p * 5. + mouse * dist * 5. + decay, 6), 1.), 0.0) * 1.5;

    color = cos(vec3(colorGain) * 16. + dist / 8.) * 0.5 + .5;
    vec3 f = c * color;
    f += c1 * color;
    f += c2 * color;
    f += s * color;
    return f;
}

void main() {
    if(!enabled) {
        discard;
    }

    vec2 uv = vUv;
    vec2 myUV = uv - 0.5;
    myUV.y *= iResolution.y / iResolution.x;
    vec2 mouse = lensPosition * 0.5;
    mouse.y *= iResolution.y / iResolution.x;

    // First LensFlarePass
    vec3 finalColor = LensFlare(myUV, mouse) * 20.0 * colorGain / 256.;

    // Additional Streaks
    if(aditionalStreaks) {
        vec3 circColor = vec3(0.9, 0.2, 0.1);
        vec3 circColor2 = vec3(0.3, 0.1, 0.9);

        for(float i = 0.; i < 10.; i++) {
            finalColor += circle(myUV, pow(rnd(i * 2000.) * 2.8, .1) + 1.41, 0.0, circColor + i, circColor2 + i, rnd(i * 20.) * 3. + 0.2 - .5, lensPosition);
        }
    }

    // Secondary Ghosts
    if(secondaryGhosts) {
        vec3 altGhosts = vec3(0.0);
        altGhosts += renderhex(myUV, -lensPosition * 0.25, ghostScale * 1.4, vec3(0.25, 0.35, 0.0));
        altGhosts += renderhex(myUV, lensPosition * 0.25, ghostScale * 0.5, vec3(1.0, 0.5, 0.5));
        altGhosts += renderhex(myUV, lensPosition * 0.1, ghostScale * 1.6, vec3(1.0));
        altGhosts += renderhex(myUV, lensPosition * 1.8, ghostScale * 2.0, vec3(0.0, 0.5, 0.75));
        altGhosts += renderhex(myUV, lensPosition * 1.25, ghostScale * 0.8, vec3(1.0, 1.0, 0.5));
        altGhosts += renderhex(myUV, -lensPosition * 1.25, ghostScale * 5.0, vec3(0.5, 0.5, 0.25));

        // Circular ghost
        altGhosts += fpow(1.0 - abs(distance(lensPosition * 0.8, myUV) - 0.7), 0.985) * colorGain / 2100.;
        finalColor += altGhosts;
    }

    // Final composed output
    gl_FragColor = vec4(mix(finalColor, vec3(0.0), opacity), 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}