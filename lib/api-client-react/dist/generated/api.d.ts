import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { ErrorEnvelope, HealthStatus, NewOrderRequest, NewOrderResponse, OrderNotFound, OrderStatus, UploadUrlRequest, UploadUrlResponse } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetOrderStatusUrl: (orderNumber: string) => string;
/**
 * Look up a customer's dress order status by order number
 * @summary Get order status
 */
export declare const getOrderStatus: (orderNumber: string, options?: RequestInit) => Promise<OrderStatus>;
export declare const getGetOrderStatusQueryKey: (orderNumber: string) => readonly [`/api/orders/${string}`];
export declare const getGetOrderStatusQueryOptions: <TData = Awaited<ReturnType<typeof getOrderStatus>>, TError = ErrorType<OrderNotFound>>(orderNumber: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOrderStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getOrderStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetOrderStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getOrderStatus>>>;
export type GetOrderStatusQueryError = ErrorType<OrderNotFound>;
/**
 * @summary Get order status
 */
export declare function useGetOrderStatus<TData = Awaited<ReturnType<typeof getOrderStatus>>, TError = ErrorType<OrderNotFound>>(orderNumber: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getOrderStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateOrderUrl: () => string;
/**
 * Creates a new custom dress order and saves it to Notion
 * @summary Submit a new custom dress order
 */
export declare const createOrder: (newOrderRequest: NewOrderRequest, options?: RequestInit) => Promise<NewOrderResponse>;
export declare const getCreateOrderMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createOrder>>, TError, {
        data: BodyType<NewOrderRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createOrder>>, TError, {
    data: BodyType<NewOrderRequest>;
}, TContext>;
export type CreateOrderMutationResult = NonNullable<Awaited<ReturnType<typeof createOrder>>>;
export type CreateOrderMutationBody = BodyType<NewOrderRequest>;
export type CreateOrderMutationError = ErrorType<ErrorEnvelope>;
/**
* @summary Submit a new custom dress order
*/
export declare const useCreateOrder: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createOrder>>, TError, {
        data: BodyType<NewOrderRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createOrder>>, TError, {
    data: BodyType<NewOrderRequest>;
}, TContext>;
export declare const getRequestUploadUrlUrl: () => string;
/**
 * Returns a presigned GCS URL for direct upload. The client sends JSON
 * metadata here, then uploads the file directly to the returned URL.
 * @summary Request a presigned URL for file upload
 */
export declare const requestUploadUrl: (uploadUrlRequest: UploadUrlRequest, options?: RequestInit) => Promise<UploadUrlResponse>;
export declare const getRequestUploadUrlMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
        data: BodyType<UploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
    data: BodyType<UploadUrlRequest>;
}, TContext>;
export type RequestUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof requestUploadUrl>>>;
export type RequestUploadUrlMutationBody = BodyType<UploadUrlRequest>;
export type RequestUploadUrlMutationError = ErrorType<ErrorEnvelope>;
/**
* @summary Request a presigned URL for file upload
*/
export declare const useRequestUploadUrl: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
        data: BodyType<UploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
    data: BodyType<UploadUrlRequest>;
}, TContext>;
export declare const getGetPublicObjectUrl: (filePath: string) => string;
/**
 * @summary Serve a public asset from PUBLIC_OBJECT_SEARCH_PATHS
 */
export declare const getPublicObject: (filePath: string, options?: RequestInit) => Promise<Blob>;
export declare const getGetPublicObjectQueryKey: (filePath: string) => readonly [`/api/storage/public-objects/${string}`];
export declare const getGetPublicObjectQueryOptions: <TData = Awaited<ReturnType<typeof getPublicObject>>, TError = ErrorType<ErrorEnvelope>>(filePath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPublicObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPublicObject>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPublicObjectQueryResult = NonNullable<Awaited<ReturnType<typeof getPublicObject>>>;
export type GetPublicObjectQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Serve a public asset from PUBLIC_OBJECT_SEARCH_PATHS
 */
export declare function useGetPublicObject<TData = Awaited<ReturnType<typeof getPublicObject>>, TError = ErrorType<ErrorEnvelope>>(filePath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPublicObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetStorageObjectUrl: (objectPath: string) => string;
/**
 * @summary Serve an object entity from PRIVATE_OBJECT_DIR
 */
export declare const getStorageObject: (objectPath: string, options?: RequestInit) => Promise<Blob>;
export declare const getGetStorageObjectQueryKey: (objectPath: string) => readonly [`/api/storage/objects/${string}`];
export declare const getGetStorageObjectQueryOptions: <TData = Awaited<ReturnType<typeof getStorageObject>>, TError = ErrorType<ErrorEnvelope>>(objectPath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStorageObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStorageObject>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStorageObjectQueryResult = NonNullable<Awaited<ReturnType<typeof getStorageObject>>>;
export type GetStorageObjectQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Serve an object entity from PRIVATE_OBJECT_DIR
 */
export declare function useGetStorageObject<TData = Awaited<ReturnType<typeof getStorageObject>>, TError = ErrorType<ErrorEnvelope>>(objectPath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStorageObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map