export const times = {
  day: { hour:'13:00', sun:[-.61, .58, .53], color:0xffebd1, power:2.8, sky:0xd9eaff, fill:.72, ambient:.55, phase:0, lamps:0 },
  dusk: { hour:'17:30', sun:[.92, .235, .26], color:0xffb774, power:2.65, sky:0xafc7ee, fill:.64, ambient:.35, phase:1, lamps:.14 },
  night: { hour:'21:30', sun:[-.66, -.30, .72], color:0xc4dbff, power:0, sky:0x91b3eb, fill:.49, ambient:.09, phase:2, lamps:1 },
};

export function surfaceWeather(wetness, grass) {
  return {
    // Rain lengthens braking and lets lateral speed decay more slowly.
    brake:1 - wetness * (grass ? .49 : .36),
    yaw:1 - wetness * .26,
    grip:(grass ? 4 : 10) * (1 - wetness * (grass ? .35 : .47)),
    drag:(grass ? .85 : .105) + wetness * (grass ? .17 : .035),
  };
}
