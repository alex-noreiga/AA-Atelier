{pkgs}: {
  deps = [
    pkgs.xorg.libXext
    pkgs.xorg.libX11
    pkgs.xorg.libxcb
    pkgs.xorg.libXrandr
    pkgs.xorg.libXfixes
    pkgs.xorg.libXdamage
    pkgs.xorg.libXcomposite
    pkgs.expat
    pkgs.mesa
    pkgs.libdrm
    pkgs.cups
    pkgs.nss
    pkgs.chromium
  ];
}
