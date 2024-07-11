import * as THREE from 'three';

export class LabelUtils {
    createTextLabel(text, fontSize = 10, textColor = '#ffffff', bgColor = 'rgba(0, 0, 0, 0.5)', scale = 0.005) {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        const fontScale = 4; // For higher resolution text
        const font = `${fontSize * fontScale}px Arial`;
        context.font = font;
        // Set canvas size
        const width = context.measureText(text).width;
        const height = fontSize * fontScale;
        canvas.width = width;
        canvas.height = height * 1.5;
        // Set background color
        context.fillStyle = bgColor;
        context.fillRect(0, 0, canvas.width, canvas.height);
        // Draw text
        context.font = font;
        context.textBaseline = 'top';
        context.fillStyle = textColor;
        context.fillText(text, 0, fontSize * fontScale * 0.25);
        const texture = new THREE.Texture(canvas);
        texture.needsUpdate = true;
        const material = new THREE.SpriteMaterial({ map: texture });
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(scale * width, scale * height / 1.5, 1);
        return sprite;
    }

    createLine(point1, point2, color = 'white', lineWidth = 2) {
        const material = new THREE.LineBasicMaterial({ color: color, linewidth: lineWidth });
        const points = [];
        points.push(new THREE.Vector3(point1.x, point1.y, point1.z));
        points.push(new THREE.Vector3(point2.x, point2.y, point2.z));
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        return line;
    }

    polarToCartesian(centerX, centerY, radius, angleInDegrees) {
        const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
        return {
            x: centerX + (radius * Math.cos(angleInRadians)),
            y: centerY + (radius * Math.sin(angleInRadians))
        };
    }
}