import { inspectRepair, type RepairRequest } from '../lib/mathRepair';

self.onmessage = ({ data }: MessageEvent<RepairRequest>) => {
  try { self.postMessage(inspectRepair(data)); }
  catch { self.postMessage(null); }
};
