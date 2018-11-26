import { Subscription } from 'rxjs'
import { bufferCount, distinctUntilChanged, startWith } from 'rxjs/operators'
import { createProxyAndHandleRequests } from '../../common/proxy'
import { ExtExtensionsAPI } from '../../extension/api/extensions'
import { Connection } from '../../protocol/jsonrpc2/connection'
import { isEqual } from '../../util'
import { ExecutableExtension, ExtensionRegistry } from '../services/extensions'

/** @internal */
export class ClientExtensions {
    private subscriptions = new Subscription()
    private proxy: ExtExtensionsAPI

    /**
     * Implements the client side of the extensions API.
     *
     * @param connection The connection to the extension host.
     * @param extensions An observable that emits the set of extensions that should be activated
     * upon subscription and whenever it changes.
     */
    constructor(connection: Connection, extensionRegistry: ExtensionRegistry) {
        this.proxy = createProxyAndHandleRequests('extensions', connection, this)

        this.subscriptions.add(
            extensionRegistry.activeExtensions
                .pipe(
                    startWith([] as ExecutableExtension[]),
                    distinctUntilChanged(),
                    bufferCount(2)
                )
                .subscribe(([oldExtensions, newExtensions]) => {
                    // Diff next state's activated extensions vs. current state's.
                    const toActivate = newExtensions
                    const toDeactivate: ExecutableExtension[] = []
                    const next: ExecutableExtension[] = []
                    if (oldExtensions) {
                        for (const x of oldExtensions) {
                            const newIndex = toActivate.findIndex(({ id }) => isEqual(x.id, id))
                            if (newIndex === -1) {
                                // Extension is no longer activated
                                toDeactivate.push(x)
                            } else {
                                // Extension is already activated.
                                toActivate.splice(newIndex, 1)
                                next.push(x)
                            }
                        }
                    }

                    /**
                     * Deactivate extensions that are no longer in use. In practice,
                     * {@link activeExtensions} never deactivates extensions, so this will never be
                     * called (in the current implementation).
                     */
                    for (const x of toDeactivate) {
                        this.proxy.$deactivateExtension(x.id).catch(err => {
                            console.warn(`Error deactivating extension ${JSON.stringify(x.id)}:`, err)
                        })
                    }

                    // Activate extensions that haven't yet been activated.
                    for (const x of toActivate) {
                        this.proxy
                            .$activateExtension(x.id, x.scriptURL)
                            .catch(err => console.error(`Error activating extension ${JSON.stringify(x.id)}:`, err))
                    }
                })
        )
    }

    public unsubscribe(): void {
        this.subscriptions.unsubscribe()
    }
}
