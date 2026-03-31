import type { CreateEventBody, UpdateEventBody } from './events.schema';
export declare function findAllPublicEvents(): Promise<({
    author: {
        name: string;
        id: string;
        lastname: string;
    };
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    date: Date;
    title: string;
    description: string;
    latitude: number;
    longitude: number;
    category: string;
    isPublic: boolean;
    authorId: string;
})[]>;
export declare function findEventById(id: string): Promise<({
    author: {
        name: string;
        id: string;
        lastname: string;
    };
} & {
    id: string;
    createdAt: Date;
    updatedAt: Date;
    date: Date;
    title: string;
    description: string;
    latitude: number;
    longitude: number;
    category: string;
    isPublic: boolean;
    authorId: string;
}) | null>;
export declare function createEvent(data: CreateEventBody & {
    authorId: string;
}): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    date: Date;
    title: string;
    description: string;
    latitude: number;
    longitude: number;
    category: string;
    isPublic: boolean;
    authorId: string;
}>;
export declare function updateEvent(id: string, data: UpdateEventBody): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    date: Date;
    title: string;
    description: string;
    latitude: number;
    longitude: number;
    category: string;
    isPublic: boolean;
    authorId: string;
}>;
export declare function deleteEvent(id: string): Promise<{
    id: string;
    createdAt: Date;
    updatedAt: Date;
    date: Date;
    title: string;
    description: string;
    latitude: number;
    longitude: number;
    category: string;
    isPublic: boolean;
    authorId: string;
}>;
//# sourceMappingURL=events.repository.d.ts.map