export declare function findUserByEmail(email: string): Promise<{
    name: string;
    email: string;
    password: string;
    id: string;
    username: string;
    lastname: string;
    bio: string | null;
    createdAt: Date;
    updatedAt: Date;
    birthdate: Date;
} | null>;
export declare function findUserById(id: string): Promise<{
    name: string;
    email: string;
    id: string;
    bio: string | null;
    createdAt: Date;
} | null>;
//# sourceMappingURL=auth.repository.d.ts.map