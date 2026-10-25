declare namespace stfDeviceDb {
  export interface DeviceName {
    id: string;
    long: string;
  }

  export interface DeviceCpu {
    name: string | null;
    cores: number | null;
    freq: number | null;
  }

  export interface DeviceMemory {
    ram: number | null;
    rom: number | null;
  }

  export interface DeviceRecord {
    name: DeviceName;
    brand: string;
    marketName: string;
    date: string | null;
    cpu: DeviceCpu | null;
    memory: DeviceMemory | null;
    image: string;
  }

  export type DeviceData = DeviceRecord;

  export interface DeviceSample extends DeviceRecord {
    model: string;
  }

  export interface FindQuery {
    model?: string | null | undefined;
    name?: string | null | undefined;
    brand?: string | null | undefined;
    manufacturer?: string | null | undefined;
    marketName?: string | null | undefined;
    platform?: string | null | undefined;
    date?: string | null | undefined;
    cpu?: Partial<DeviceCpu> | null | undefined;
    memory?: Partial<DeviceMemory> | null | undefined;
    image?: string | null | undefined;
  }

  export type DeviceSvgSize = 'x24' | 'x120' | 'x800';

  export interface DeviceDisplayParams {
    width?: number | null | undefined;
    height?: number | null | undefined;
    xdpi?: number | null | undefined;
    ydpi?: number | null | undefined;
    dpi?: number | null | undefined;
    inches?: number | null | undefined;
    diagonal?: number | null | undefined;
  }

  export interface GenerateDeviceSvgParams extends Omit<FindQuery, 'name'>, DeviceDisplayParams {
    name?: string | { id?: string | null | undefined; long?: string | null | undefined } | null | undefined;
    size?: DeviceSvgSize | string | undefined;
    sdk?: number | string | null | undefined;
    sdkVersion?: number | string | null | undefined;
    version?: { sdk?: number | string | null | undefined } | string | null | undefined;
    /** Nested display metrics; `display.size` is the physical diagonal in inches (STF DeviceDisplayMessage). */
    display?: (DeviceDisplayParams & { size?: number | null | undefined }) | null | undefined;
  }

  export type StfDeviceSvgParams = GenerateDeviceSvgParams;

  export function find(properties?: FindQuery | null): DeviceRecord | null;
  export function sample(): DeviceSample;
  export function brandsMatch(a?: string | null, b?: string | null): boolean;
  export function generateDeviceSvg(params?: GenerateDeviceSvgParams | null): string;
  export function getDeviceSvgDataUri(params?: GenerateDeviceSvgParams | null): string;
}

export = stfDeviceDb;
