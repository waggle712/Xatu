import { fitWithin } from './prepare';

describe('fitWithin', () => {
  it('leaves small photos alone', () => {
    expect(fitWithin(1200, 900)).toBeNull();
  });
  it('shrinks the longest side to 2048 and keeps the ratio', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1536, height: 2048 });
  });
});
