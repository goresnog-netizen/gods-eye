/**
 * Globe Integration — Fly to target location on God's Eye globe.
 * 
 * Generates JS code snippets for CesiumJS camera flyTo.
 * All local, no external calls.
 */

// i18n-ignore: CSS font shorthand inside generated Cesium code
const MARKER_LABEL_FONT = '14pt sans-serif';

export function generateFlyToCode(lat, lon, altitude = 5000, duration = 3) {
  return `viewer.camera.flyTo({
  destination: Cesium.Cartesian3.fromDegrees(${lon}, ${lat}, ${altitude}),
  orientation: {
    heading: Cesium.Math.toRadians(0),
    pitch: Cesium.Math.toRadians(-45),
    roll: 0.0,
  },
  duration: ${duration},
  easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
});`;
}

export function generateTargetMarker(lat, lon, label = 'Target', color = '#ff0000') {
  return `viewer.entities.add({
  name: '${label}',
  position: Cesium.Cartesian3.fromDegrees(${lon}, ${lat}),
  point: {
    pixelSize: 12,
    color: Cesium.Color.fromCssColorString('${color}'),
    outlineColor: Cesium.Color.WHITE,
    outlineWidth: 2,
  },
  label: {
    text: '${label}',
    font: '${MARKER_LABEL_FONT}',
    fillColor: Cesium.Color.WHITE,
    outlineColor: Cesium.Color.BLACK,
    outlineWidth: 2,
    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
    pixelOffset: new Cesium.Cartesian2(0, -15),
  },
});`;
}

export function generateCellTowerOverlay(cellResult) {
  const { lat, lon, carrier, accuracy, estimated } = cellResult;
  const color = estimated ? '#ffaa00' : '#00ff00';
  const label = `${carrier.name} - ${estimated ? 'EST' : 'REAL'}`;
  
  return generateTargetMarker(lat, lon, label, color) + '\n' + generateFlyToCode(lat, lon, accuracy * 2, 2);
}

export function generatePhoneLocationOverlay(phoneResult) {
  const { lat, lon, location, country } = phoneResult;
  if (!lat || !lon) return null;
  
  return generateTargetMarker(lat, lon, `${location}, ${country}`, '#00aaff') + '\n' + generateFlyToCode(lat, lon, 10000, 3);
}

export function generateMultiTargetOverlay(targets) {
  const codes = targets.map(t => 
    generateTargetMarker(t.lat, t.lon, t.name || t.id, t.color || '#ff0000')
  );
  return codes.join('\n');
}

function generateMultiTarget(targets) { return generateMultiTargetOverlay(targets); }

/**
 * CLI
 */
async function main() {
  const args = process.argv.slice(2);
  let lat = -4.5326, lon = 140.5066, label = 'Target';
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--lat' && args[i + 1]) { lat = parseFloat(args[i + 1]); i++; }
    else if (args[i] === '--lon' && args[i + 1]) { lon = parseFloat(args[i + 1]); i++; }
    else if (args[i] === '--label' && args[i + 1]) { label = args[i + 1]; i++; }
  }
  
  console.log('=== Globe Fly-To Code ===');
  console.log(generateFlyToCode(lat, lon));
  console.log('\n=== Target Marker Code ===');
  console.log(generateTargetMarker(lat, lon, label));
}

if (process.argv[1] && process.argv[1].endsWith('globe-integration.mjs')) {
  main().catch(e => {
    console.error('Error:', e.message);
    process.exit(1);
  });
}

// Exports are done via `export function` declarations above.