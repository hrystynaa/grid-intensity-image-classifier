export const CLASSES = [
  { id: 'lake', label: 'Озеро' },
  { id: 'snowfield', label: 'Снігова рівнина' },
  { id: 'starry_sky', label: 'Зоряне небо' },
];

export const GROUPS = [
  { id: '4k', label: '4K, висока якість' },
  { id: 'fullhd', label: 'Full HD' },
  { id: 'medium', label: 'Середня якість' },
  { id: 'icons_32', label: 'Іконки 32×32' },
];

export const FORMATS = [
  { id: 'jpg', label: 'JPG' },
  { id: 'png', label: 'PNG' },
  { id: 'bmp', label: 'BMP' },
];

export const classLabel = (id) => CLASSES.find((c) => c.id === id)?.label ?? id;
export const groupLabel = (id) => GROUPS.find((g) => g.id === id)?.label ?? id;
export const formatLabel = (id) => FORMATS.find((f) => f.id === id)?.label ?? id;
