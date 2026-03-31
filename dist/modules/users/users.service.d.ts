import type { CreateUserBody } from './users.schema';
export declare function registerUser(data: CreateUserBody): Promise<{
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
//# sourceMappingURL=users.service.d.ts.map