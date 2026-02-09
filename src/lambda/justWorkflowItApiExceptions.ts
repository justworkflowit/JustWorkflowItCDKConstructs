/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line @typescript-eslint/no-require-imports
export type SmithyErrorClass = new (args: any) => Error;

export async function buildSmithyErrorRegistry(): Promise<Record<string, SmithyErrorClass>> {
    const module = await import('@justworkflowit/api-client');
    console.log(module);
    return Object.entries(module)
        .filter(([key, val]) => {
            return (
                typeof val === 'function' &&
                key.endsWith('Error') // &&
                // typeof (val as any).prototype?.errorType === 'string' &&
                // typeof (val as any).prototype?.constructor === 'function'
            );
        })
        .reduce((acc, [name, ctor]) => {
            acc[name] = ctor as SmithyErrorClass;
            return acc;
        }, {} as Record<string, SmithyErrorClass>);
}

export async function deserializeSmithyError(err: any): Promise<Error> {
    if (!err || typeof err !== 'object') return new Error('Unknown error');

    const registry = await buildSmithyErrorRegistry();
    const typeName = err?.errorType;

    if (typeName && registry[typeName]) {
        const ErrorClass = registry[typeName];
        const { message, errorType, statusCode, ...rest } = err;
        return new ErrorClass({
            message: typeof message === 'string' ? message : 'Unknown error',
            errorType,
            statusCode,
            ...rest,
        });
    }

    return new Error(err?.message || 'Unknown error');
}
