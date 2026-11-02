import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DETAIL_FAR_ERROR,
  DETAIL_NEAR_ERROR,
  DETAIL_NEAR_M,
  detailErrorForHeight,
  installCloseRangeDetail,
} from './closeRangeDetail.js';

test('a close camera asks for sharper tiles than a distant one', () => {
  assert.equal(detailErrorForHeight(400), DETAIL_NEAR_ERROR);
  assert.equal(detailErrorForHeight(DETAIL_NEAR_M), DETAIL_NEAR_ERROR);
  assert.equal(detailErrorForHeight(DETAIL_NEAR_M + 1), DETAIL_FAR_ERROR);
  assert.equal(detailErrorForHeight(9_000_000), DETAIL_FAR_ERROR);
  assert.ok(
    DETAIL_NEAR_ERROR < DETAIL_FAR_ERROR,
    'lower error is the sharper one',
  );
});

test('an unknown altitude keeps the Cesium default', () => {
  assert.equal(detailErrorForHeight(NaN), DETAIL_FAR_ERROR);
  assert.equal(detailErrorForHeight(undefined), DETAIL_FAR_ERROR);
  assert.equal(detailErrorForHeight(null), DETAIL_FAR_ERROR);
});

function fakeViewer(height) {
  const listeners = [];
  const globe = { maximumScreenSpaceError: DETAIL_FAR_ERROR };
  const viewer = {
    isDestroyed: () => false,
    camera: {
      positionCartographic: { height },
      changed: {
        addEventListener: (fn) => {
          listeners.push(fn);
          return () => listeners.splice(listeners.indexOf(fn), 1);
        },
      },
    },
    scene: { globe },
  };
  return { viewer, globe, listeners };
}

test('installing applies the close setting immediately', () => {
  const { viewer, globe } = fakeViewer(800);
  const remove = installCloseRangeDetail(viewer);
  assert.equal(globe.maximumScreenSpaceError, DETAIL_NEAR_ERROR);
  remove();
});

test('moving the camera updates the setting both ways', () => {
  const { viewer, globe, listeners } = fakeViewer(800);
  installCloseRangeDetail(viewer);
  assert.equal(listeners.length, 1);

  viewer.camera.positionCartographic.height = 900_000;
  listeners[0]();
  assert.equal(globe.maximumScreenSpaceError, DETAIL_FAR_ERROR);

  viewer.camera.positionCartographic.height = 300;
  listeners[0]();
  assert.equal(globe.maximumScreenSpaceError, DETAIL_NEAR_ERROR);
});

test('a viewer without a globe is left alone instead of throwing', () => {
  const remove = installCloseRangeDetail({});
  assert.equal(typeof remove, 'function');
  remove();
});
