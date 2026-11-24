const unit = value => Math.max(0, Math.min(1, value));

export function tireFeedback(speed, sideSlip, brake, grass) {
  const moving = unit((speed - 3) / 9);
  const lateral = unit((Math.abs(sideSlip) - .23) / 1.05);
  const braking = unit((brake - .44) / .56) * moving;
  const stress = unit(.8 * lateral + .76 * braking) * moving;
  if (grass) {
    return {squeal:0, smoke:0, dust:unit(stress * .85 + moving * .24)};
  }
  return {
    squeal:stress,
    smoke:unit((stress - .38) / .62),
    dust:0,
  };
}
