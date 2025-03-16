Hooks.once('init', async () => {
    if (game.system.id !== 'castles-and-crusades') return;

    // Register a single on/off setting
    game.settings.register('cnc-roll-dialog', 'enabled', {
        name: 'Enable Roll Dialog',
        hint: 'Turn on to show a modifier dialog for all rolls (except initiative).',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true,
        onChange: value => console.log(`Roll dialog enabled: ${value}`)
    });

    // Load templates with corrected path
    try {
        await loadTemplates([
            '/modules/cnc-roll-dialog/templates/roll-dialog.hbs'
        ]);
        console.log('Templates loaded successfully');
    } catch (err) {
        console.error('Failed to load templates:', err);
    }

    console.log('C&C Roll Dialog module initialized');

    // Inject custom CSS to match Castles & Crusades theme with adjusted spacing
    const style = document.createElement('style');
    style.textContent = `
        .cnc-roll-dialog {
            background-color: transparent; /* Use actor sheet parchment */
            color: #333333; /* Dark text for readability */
            font-family: Georgia, "Times New Roman", serif; /* Medieval serif font */
            border: 2px solid #8b4513; /* Red frame for medieval feel */
            border-radius: 5px;
            width: 100%; /* Stretch to fill dialog window */
            min-height: 100px; /* Ensure enough space for content */
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 0; /* Remove inner padding to eliminate extra space */
            box-sizing: border-box; /* Include border in width/height calculations */
        }
        .cnc-roll-dialog .content-wrapper {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%; /* Ensure content uses full width */
            padding: 10px; /* Inner padding for content */
        }
        .cnc-roll-dialog p {
            margin: 5px 0;
            font-size: 16px;
            display: flex;
            justify-content: center;
            align-items: center;
            background-color: transparent;
        }
        .cnc-roll-dialog div {
            padding: 5px;
            display: flex;
            justify-content: center;
            align-items: center;
        }
        .cnc-roll-dialog input[type="number"] {
            width: 60px;
            padding: 5px;
            margin: 5px 0;
            border: 1px solid #8b4513;
            background-color: #fffaf0;
            font-family: Georgia, "Times New Roman", serif;
            text-align: center;
        }
    `;
    document.head.appendChild(style);

    // Store original methods
    const originalToMessage = Roll.prototype.toMessage;

    // Track processed actions globally (for dialog suppression)
    const processedActions = new Map();

    // Track initiative-related rolls to skip sub-roll dialogs
    const skipSubRollsForInitiative = new Set();

    // Override Roll.prototype.toMessage to intercept rolls before evaluation
    Roll.prototype.toMessage = async function(message, options = {}) {
        console.log('Roll.toMessage intercepted:', this.formula, 'Message:', JSON.stringify(message, null, 2), 'Options:', JSON.stringify(options, null, 2));
        console.log('Roll actor:', this.actor ? this.actor.name : 'No actor');
        console.log('Roll data:', this.data ? JSON.stringify(this.data, null, 2) : 'No data');

        // Skip if disabled, bypassed, or already processed
        if (!game.settings.get('cnc-roll-dialog', 'enabled') || options.skipDialog) {
            console.log('Dialog skipped, proceeding with original toMessage');
            return originalToMessage.call(this, message, options);
        }

        // Skip initiative rolls (e.g., max(1,1d10))
        if (this.formula.toLowerCase().includes('max(1,1d10)')) {
            console.log('Skipping dialog for initiative roll:', this.formula);
            return originalToMessage.call(this, message, options);
        }

        // Determine roll type (modifier for all non-initiative rolls)
        console.log('Detected roll type: modifier (all non-initiative rolls)');
        const rollType = 'modifier';

        // Generate a unique key for this action with timestamp
        const actionId = options.actionId || this.id || Date.now().toString(36);
        const actionKey = `${actionId}_${rollType}_${Date.now()}`;

        // Check if this action was recently processed (for dialog suppression)
        if (processedActions.has(actionKey)) {
            console.log(`Action already processed for ${actionKey}, skipping dialog`);
            return originalToMessage.call(this, message, options);
        }

        // Prepare dialog data with cleaned formula
        const cleanFormula = this.formula.replace(/\s*\(\)\s*$/, '');
        const dialogData = {
            formula: cleanFormula
        };

        // Render dialog with renderTemplate
        let content;
        try {
            content = await renderTemplate('/modules/cnc-roll-dialog/templates/roll-dialog.hbs', dialogData);
            console.log('Template rendered successfully');
        } catch (err) {
            console.error('Template rendering failed, using fallback:', err);
            content = `
                <div class="cnc-roll-dialog">
                    <div class="content-wrapper">
                        <p>Roll: ${cleanFormula}</p>
                        <div><label>Additional Modifier: <input type="number" name="extraMod" value="0"></label></div>
                    </div>
                </div>
            `;
        }

        const dialogResult = await new Promise(resolve => {
            console.log('Rendering dialog for:', cleanFormula);
            new Dialog({
                title: 'Modifiers',
                content: content,
                buttons: {
                    roll: {
                        label: 'Roll',
                        callback: html => {
                            const extraMod = parseInt(html.find('[name="extraMod"]').val()) || 0;
                            resolve({ proceed: true, extraMod });
                        }
                    },
                    cancel: {
                        label: 'Cancel',
                        callback: () => resolve({ proceed: false, extraMod: 0 })
                    }
                },
                default: 'roll'
            }).render(true);
        });

        console.log('Dialog result:', dialogResult);
        if (!dialogResult.proceed) {
            console.log('Roll canceled');
            return null;
        }

        // Apply modifier and update the roll
        const totalModifier = dialogResult.extraMod;
        if (totalModifier !== 0) {
            const sign = totalModifier >= 0 ? '+' : '';
            const newFormula = `${cleanFormula} ${sign} ${totalModifier}`;
            console.log('New formula:', newFormula);
            this.formula = newFormula;
            this.terms = Roll.parse(newFormula, this.data || {});
            this._formula = newFormula;
        }

        // Mark this action as processed (for dialog suppression)
        processedActions.set(actionKey, true);
        setTimeout(() => processedActions.delete(actionKey), 1000);

        // Proceed with the original toMessage call, ensuring skipDialog is set
        options.skipDialog = true;
        const result = await originalToMessage.call(this, message, options);
        console.log('Roll sent to message:', this.formula, 'Total:', this.total);
        return result;
    };

    // Add isSubRoll method to Roll prototype
    Roll.prototype.isSubRoll = function(options) {
        const isMaxSubRoll = this.formula.match(/^(1|1d10)$/);
        return isMaxSubRoll;
    };

    // Determine roll type (modifier for all non-initiative rolls)
    function determineRollType(roll, message, options) {
        console.log('Determining roll type with flavor:', message.flavor, 'Options:', JSON.stringify(options, null, 2));
        return 'modifier';
    }
});

// Handlebars helper
Handlebars.registerHelper('capitalize', str => str.charAt(0).toUpperCase() + str.slice(1));