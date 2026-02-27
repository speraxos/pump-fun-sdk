declare const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export declare const Base58Schema: any;
export declare const SolanaAddressSchema: any;
export declare const PrefixSchema: any;
export declare const SuffixSchema: any;
export declare const PrivateKeySchema: any;
export declare const SeedPhraseSchema: any;
export declare function isValidBase58(str: string): boolean;
export declare function isValidSolanaAddress(address: string): boolean;
export declare function sanitizeInput(input: string): string;
export declare function validatePrefix(prefix: string): {
    valid: boolean;
    error?: string;
};
export declare function validateSuffix(suffix: string): {
    valid: boolean;
    error?: string;
};
export { BASE58_CHARS };
//# sourceMappingURL=validation.d.ts.map