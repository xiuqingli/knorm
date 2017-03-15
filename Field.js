const { camelCase, snakeCase } = require('lodash');
const createError = require('./lib/createError');

class Field {
    constructor(config = {}) {
        const { name, model, type, validate } = config;

        if (!name) {
            throw new Error('Field requires a name');
        }

        if (!model || !(model.prototype instanceof Model)) {
            throw new Error(`Field '${name}' requires a subclass of Model`);
        }

        if (!type) {
            throw new Error(
                `Field '${model.name}.${name}' has no type configured`
            );
        }

        if (!typesArray.includes(type)) {
            throw new Error(
                `Field '${model.name}.${name}' has an invalid type ('${type}')`
            );
        }

        if (validate && typeof validate !== 'function') {
            throw new Error(
                `Custom validator for field '${model.name}.${name}' should be a function`
            );
        }

        this.name = name;
        this.type = type;
        this.setModel(model);

        if (config.default) {
            this.default = config.default;
        }

        const validators = { type };
        const { required, minLength, maxLength, oneOf } = config;

        if (validate) { validators.validate = validate; }
        if (required) { validators.required = required; }
        if (minLength) { validators.minLength = minLength; }
        if (maxLength) { validators.maxLength = maxLength; }
        if (oneOf) { validators.oneOf = oneOf; }

        this.validators = validators;

        if (config.default) {
            this.default = config.default;
        }

        const { references } = config;
        if (references) {
            this.setReference(references);
        }

        let { column } = config;
        if (!column) {
            column = this.getColumnName();
        }
        this.column = column;
    }

    getColumnName() {
        return snakeCase(this.name);
    }

    clone() {
        const clone = new this.constructor({
            name: this.name,
            type: this.type,
            model: this.model,
            default: this.default,
            references: this.references,
        });
        clone.validators = this.validators;
        return clone;
    }

    validateIsRequired(value) {
        if (!isSet(value)) {
            throw new this.errors.Required();
        }
    }

    validateWith(value, validate) {
        if (!isSet(value)) {
            return true;
        }
        if (!validate(value)) {
            throw new this.errors.Type();
        }
    }

    validateIsText(value) {
        this.validateWith(value, value => typeof value === 'string');
    }

    validateIsBinary(value) {
        this.validateWith(value, value => value instanceof Buffer);
    }

    validateIsString(value) {
        this.validateIsText(value);
    }

    validateIsInteger(value) {
        this.validateWith(value, value => Number.isInteger(value));
    }

    validateIsBoolean(value) {
        this.validateWith(value, value => typeof value === 'boolean');
    }

    validateIsDateTime(value) {
        this.validateWith(value, value => value instanceof Date);
    }

    validateWithRegex(value, pattern) {
        this.validateWith(value, value => pattern.test(value));
    }

    validateIsUuid(value) {
        // source: https://github.com/chriso/validator.js/blob/6.2.1/src/lib/isUUID.js
        this.validateWithRegex(
            value,
            /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i
        );
    }

    validateIsUuidV4(value) {
        // source: https://github.com/chriso/validator.js/blob/6.2.1/src/lib/isUUID.js
        this.validateWithRegex(
            value,
            /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
        );
    }

    validateIsDecimal(value) {
        // source: https://github.com/chriso/validator.js/blob/6.2.1/src/lib/isDecimal.js
        this.validateWithRegex(value, /^[-+]?([0-9]+|\.[0-9]+|[0-9]+\.[0-9]+)$/);
    }

    validateIsJson(value) {
        this.validateIsText(value);
        this.validateWith(value, value => {
            let object;

            try {
                // TODO: this is expensive!
                object = JSON.parse(value);
            } catch (e) {
                return false;
            }

            return !!object && typeof object === 'object';
        });
    }

    validateTypeIs(value, type) {
        switch (type) {
        case types.text:
            return this.validateIsText(value);

        case types.binary:
            return this.validateIsBinary(value);

        case types.string:
            return this.validateIsString(value);

        case types.integer:
            return this.validateIsInteger(value);

        case types.boolean:
            return this.validateIsBoolean(value);

        case types.dateTime:
            return this.validateIsDateTime(value);

        case types.uuid:
            return this.validateIsUuid(value);

        case types.uuidV4:
            return this.validateIsUuidV4(value);

        case types.json:
            return this.validateIsJson(value);

        case types.decimal:
            return this.validateIsDecimal(value);

        default:
            throw new Error(`no validator has been added for '${type}' types`);
        }
    }

    validateMinLengthIs(value, minLength) {
        if (!isSet(value)) {
            return true;
        }

        if (value.length < minLength) {
            throw new this.errors.MinLength();
        }
    }

    validateMaxLengthIs(value, maxLength) {
        if (!isSet(value)) {
            return true;
        }

        if (value.length > maxLength) {
            throw new this.errors.MaxLength();
        }
    }

    validateIsOneOf(value, oneOf) {
        if (!isSet(value)) {
            return true;
        }

        if (!oneOf.includes(value)) {
            throw new this.errors.OneOf();
        }
    }

    async validateWithCustom(value, validate, modelInstance) {
        if (!isSet(value)) {
            return true;
        }

        const returnValue = await validate.call(modelInstance, value);

        if (returnValue === false) {
            throw new this.errors.Custom();
        }

        if (typeof returnValue === 'object') {
            return this.validateWithValidators(value, returnValue, modelInstance);
        }
    }

    async validateWithValidators(value, validators, modelInstance) {
        const {
            required,
            type,
            minLength,
            maxLength,
            oneOf,
            validate,
        } = validators;

        if (required) {
            this.validateIsRequired(value);
        }

        if (type) {
            this.validateTypeIs(value, type);
        }

        if (minLength) {
            this.validateMinLengthIs(value, minLength);
        }

        if (maxLength) {
            this.validateMaxLengthIs(value, maxLength);
        }

        if (oneOf) {
            this.validateIsOneOf(value, oneOf);
        }

        if (validate) {
            await this.validateWithCustom(value, validate, modelInstance);
        }
    }

    async validate(value, modelInstance) {
        await this.validateWithValidators(value, this.validators, modelInstance);
    }

    hasDefault() {
        return this.default !== undefined;
    }

    getDefault(modelInstance) {
        const defaultValue = this.default;

        if (typeof defaultValue === 'function') {
            return defaultValue.call(modelInstance);
        }

        return defaultValue;
    }

    setReference(reference) {
        if (!this.model.references[reference.model.name]) {
            this.model.references[reference.model.name] =  {};
        }
        this.model.references[reference.model.name][this.name] = reference;

        if (!reference.model.referenced[this.model.name]) {
            reference.model.referenced[this.model.name] =  {};
        }
        reference.model.referenced[this.model.name][reference.name] = this;

        this.references = reference;

        return this;
    }

    setModel(model) {
        if (this.model && this.references) {
            const reference = this.references;
            const backReference = reference.model.referenced[this.model.name];
            reference.model.referenced[model.name] = backReference;
            // TODO: delete though?
            delete reference.model.referenced[this.model.name];
        }

        this.model = model;

        const ModelField = upperCamelCase(this.model.name) + upperCamelCase(this.name);
        this.errors = {
            Required: createError(`MissingRequired${ModelField}Error`),
            Type: createError(`Invalid${ModelField}TypeError`),
            MinLength: createError(`${ModelField}TooShortError`),
            MaxLength: createError(`${ModelField}TooLongError`),
            OneOf: createError(`Unknown${ModelField}Error`),
            Custom: createError(`Invalid${ModelField}Error`),
        };

        return this;
    }
}

const upperCamelCase = string => {
    return camelCase(string).replace(/\b\w/g, match => {
        return match.toUpperCase();
    });
};

const isSet = value => value !== undefined && value !== null;

// TODO: add password field
// TODO: allow adding types
const types = {
    text: 'text',
    json: 'json',
    uuid: 'uuid',
    binary: 'binary',
    uuidV4: 'uuidV4',
    decimal: 'decimal',
    string: 'string',
    boolean: 'boolean',
    integer: 'integer',
    dateTime: 'dateTime',
};

const typesArray = Object.values(types);

Field.types = types;

module.exports = Field;

const Model = require('./Model'); // circular dep