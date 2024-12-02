return {
  black = 0xff181819,
  white = 0xfffcfcfd,
  red = 0xffed8796,
  green = 0xffa6da95,
  blue = 0xff76cce0,
  yellow = 0xffe7c664,
  orange = 0xfff39660,
  magenta = 0xffb39df3,
  grey = 0xff7f8490,
  purple=0xff8aadf4,
  transparent = 0x00000000,

  bar = {
    bg = 0xff18191d,
    border = 0xff2c2e34,
  },
  popup = {
    bg = 0xc02c2e34,
    border = 0xff7f8490
  },
  bg1 = 0xff23262f,
  bg2 = 0xff23262f,

  with_alpha = function(color, alpha)
    if alpha > 1.0 or alpha < 0.0 then return color end
    return (color & 0x00ffffff) | (math.floor(alpha * 255.0) << 24)
  end,
}
