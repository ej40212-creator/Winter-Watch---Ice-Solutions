// Export-only typed loader: raw location records were deliberately omitted.
import records from './sites.json';
export interface SiteRecord {key:string;id:string;region:string;address:string;state:string;classification:string}
export default records as SiteRecord[];
