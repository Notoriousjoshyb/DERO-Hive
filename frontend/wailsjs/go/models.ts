export namespace main {
	
	export class ConsoleLog {
	    timestamp: string;
	    level: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new ConsoleLog(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = source["timestamp"];
	        this.level = source["level"];
	        this.message = source["message"];
	    }
	}
	export class DocFile {
	    Name: string;
	    Content: string;
	    DocType: string;
	
	    static createFrom(source: any = {}) {
	        return new DocFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Name = source["Name"];
	        this.Content = source["Content"];
	        this.DocType = source["DocType"];
	    }
	}
	export class Rating {
	    address: string;
	    rating: number;
	    height: number;
	
	    static createFrom(source: any = {}) {
	        return new Rating(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.address = source["address"];
	        this.rating = source["rating"];
	        this.height = source["height"];
	    }
	}
	export class RatingResult {
	    scid: string;
	    ratings?: Rating[];
	    likes: number;
	    dislikes: number;
	    average: number;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new RatingResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scid = source["scid"];
	        this.ratings = this.convertValues(source["ratings"], Rating);
	        this.likes = source["likes"];
	        this.dislikes = source["dislikes"];
	        this.average = source["average"];
	        this.count = source["count"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SearchResult {
	    success: boolean;
	    type: string;
	    query: string;
	    data?: Record<string, any>;
	    error?: string;
	    message?: string;
	
	    static createFrom(source: any = {}) {
	        return new SearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.type = source["type"];
	        this.query = source["query"];
	        this.data = source["data"];
	        this.error = source["error"];
	        this.message = source["message"];
	    }
	}
	export class StorageCategory {
	    id: string;
	    label: string;
	    description: string;
	    tier: string;
	    color: string;
	    path: string;
	    size_bytes: number;
	    item_label: string;
	    last_write: number;
	    recovery: string;
	    clearable: boolean;
	    blocked_by: string;
	    in_use: boolean;
	    managed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StorageCategory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.description = source["description"];
	        this.tier = source["tier"];
	        this.color = source["color"];
	        this.path = source["path"];
	        this.size_bytes = source["size_bytes"];
	        this.item_label = source["item_label"];
	        this.last_write = source["last_write"];
	        this.recovery = source["recovery"];
	        this.clearable = source["clearable"];
	        this.blocked_by = source["blocked_by"];
	        this.in_use = source["in_use"];
	        this.managed = source["managed"];
	    }
	}
	export class StorageUsage {
	    base_path: string;
	    total_bytes: number;
	    categories: StorageCategory[];
	
	    static createFrom(source: any = {}) {
	        return new StorageUsage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.base_path = source["base_path"];
	        this.total_bytes = source["total_bytes"];
	        this.categories = this.convertValues(source["categories"], StorageCategory);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TELAContent {
	    HTML: string;
	    CSS: string[];
	    JS: string[];
	    CSSByName: Record<string, string>;
	    JSByName: Record<string, string>;
	    StaticByName: Record<string, string>;
	    Meta: Record<string, any>;
	    SCIDs: Record<string, string>;
	    Files: DocFile[];
	
	    static createFrom(source: any = {}) {
	        return new TELAContent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.HTML = source["HTML"];
	        this.CSS = source["CSS"];
	        this.JS = source["JS"];
	        this.CSSByName = source["CSSByName"];
	        this.JSByName = source["JSByName"];
	        this.StaticByName = source["StaticByName"];
	        this.Meta = source["Meta"];
	        this.SCIDs = source["SCIDs"];
	        this.Files = this.convertValues(source["Files"], DocFile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WalletInfo {
	    path: string;
	    filename: string;
	    addressPrefix: string;
	    lastUsed: number;
	    isCurrent: boolean;
	    network: string;
	
	    static createFrom(source: any = {}) {
	        return new WalletInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.filename = source["filename"];
	        this.addressPrefix = source["addressPrefix"];
	        this.lastUsed = source["lastUsed"];
	        this.isCurrent = source["isCurrent"];
	        this.network = source["network"];
	    }
	}

}

export namespace walletapi {
	
	export class KDF {
	    hash: string;
	    keylen: number;
	    iterations: number;
	    salt: number[];
	
	    static createFrom(source: any = {}) {
	        return new KDF(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hash = source["hash"];
	        this.keylen = source["keylen"];
	        this.iterations = source["iterations"];
	        this.salt = source["salt"];
	    }
	}
	export class Wallet_Disk {
	    // Go type: semver
	    version: any;
	    secret: number[];
	    // Go type: KDF
	    kdf: any;
	    account_encrypted: number[];
	
	    static createFrom(source: any = {}) {
	        return new Wallet_Disk(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = this.convertValues(source["version"], null);
	        this.secret = source["secret"];
	        this.kdf = this.convertValues(source["kdf"], null);
	        this.account_encrypted = source["account_encrypted"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

