import type { CreateEventBody, UpdateEventBody } from './events.schema';
export declare function listPublicEvents(): Promise<({
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
export declare function getEventById(id: string): Promise<{
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
}>;
export declare function addEvent(data: CreateEventBody, authorId: string): Promise<{
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
export declare function editEvent(id: string, data: UpdateEventBody, requesterId: string): Promise<{
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
export declare function removeEvent(id: string, requesterId: string): Promise<{
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
//# sourceMappingURL=events.service.d.ts.map