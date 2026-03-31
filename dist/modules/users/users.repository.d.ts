import type { CreateUserBody } from './users.schema';
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
export declare function findUserByUsername(username: string): Promise<{
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
export declare function createUser(data: Omit<CreateUserBody, 'password'> & {
    password: string;
}): Promise<{
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
}>;
//# sourceMappingURL=users.repository.d.ts.map