import type { LoginBody } from './auth.schema';
export declare function validateLogin(data: LoginBody): Promise<{
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
export declare function getAuthenticatedUser(id: string): Promise<{
    name: string;
    email: string;
    id: string;
    bio: string | null;
    createdAt: Date;
}>;
//# sourceMappingURL=auth.service.d.ts.map