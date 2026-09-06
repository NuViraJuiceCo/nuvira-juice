let epoch = 0;

export const beginAuthOperation = () => ++epoch;
export const currentAuthOperation = () => epoch;
export const isCurrentAuthOperation = (candidate) => candidate === epoch;
