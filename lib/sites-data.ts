// Runnable demo records only. The operational workbook is not shipped in this module.
import records from "../fixtures/synthetic-sites.json";

export interface SiteRecord {
  key: string;
  id: string;
  region: string;
  address: string;
  state: string;
  classification: string;
  demo?: boolean;
}

export default records as SiteRecord[];
