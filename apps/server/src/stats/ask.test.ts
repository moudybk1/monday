import { expect, it } from 'vitest';
import { normalise } from './ask';

it('keeps the menu spelling of keys and presets, and turns one preset into a list', () => {
  // Models answer in their own casing: a lower-cased minCloses must not be dropped as an unknown key.
  expect(normalise({ KIND: 'Screen', mincloses: '100', MinVolume: 5e5, presets: ['Whales', 'LIQUIDATED'], dropped: 'the SOL side' }))
    .toEqual({ kind: 'screen', minCloses: 100, minVolume: 5e5, presets: ['whales', 'liquidated'], dropped: 'the SOL side' });
  expect(normalise({ kind: 'screen', preset: 'Makers' })).toEqual({ kind: 'screen', presets: ['makers'] });
  expect(normalise({ kind: 'screen', preset: 'all' })).toEqual({ kind: 'screen' }); // everyone is no filter at all
});
