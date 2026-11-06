import { v4, v5 } from 'uuid';

const SOURCE_NS = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const newId = (): string => v4();
/** Stały UUID obiektu OSM: to samo odkrycie na dwóch urządzeniach daje ten sam rekord. */
export const idForSourceRef = (ref: string): string => v5(ref, SOURCE_NS);
