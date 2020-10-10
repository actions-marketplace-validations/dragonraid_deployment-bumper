const { File } = require('./file');
const { Repository } = require('./github');
const { Ubuntu } = require('./ubuntu');

// load environment variables from .env file if not running in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Check if environment variable exists, otherwise set default
const RAW_CONFIG = {
    TYPE: process.env.TYPE || null,
    FILE: process.env.FILE || null,
    KEYS: process.env.KEYS || null,
    BRANCH_NAME: process.env.BRANCH_NAME || process.env.TYPE,
    BRANCH_PREFIX: process.env.BRANCH_PREFIX || 'update',
    REPOSITORY: process.env.REPOSITORY || null,
    USERNAME: process.env.USERNAME || null,
    PASSWORD: process.env.PASSWORD || null,
};

const CONFIG = {};

/**
 * This function processes RAW_CONFIG object. Reasoning is that environment
 * variables, that populates th Config can only contain string, but sometimes
 * we need other types. It also checks, if RAW_CONFIG object contains all
 * necessary properties and those properties are valid.
 */
const processConfig = () => {
    for (const [key, value] of Object.entries(RAW_CONFIG)) {
        if (!value) {
            if (value === 'USERNAME' || value === 'PASSWORD') continue;
            throw new Error(
                `Invalid configuration value: ${value} for ${key}.`,
            );
        }
        switch (key) {
            case 'KEYS':
                CONFIG[key] = value.split(',');
                break;
            default:
                CONFIG[key] = value;
        }
    }
};

const handleUbuntu = async () => {
    const filterValues = {
        cloud: process.env.CLOUD || null,
        zone: process.env.ZONE || null,
        version: process.env.VERSION || null,
        architecture: process.env.ARCHITECTURE || null,
        instanceType: process.env.INSTANCE_TYPE || null,
        release: process.env.RELEASE || null,
    };

    const filter = {};
    Object.keys(filterValues).forEach((value) => {
        if (filterValues[value]) filter[value] = filterValues[value];
    });
    const ubuntu = new Ubuntu(filter);
    const latestUbuntu = await ubuntu.latest;
    const keyValuePairs = {};
    CONFIG.KEYS.forEach((key) => {
        keyValuePairs[key] = latestUbuntu.id;
    });

    return keyValuePairs;
};

const initializeRepo = async (branchName) => {
    const repository = new Repository({
        repository: CONFIG.REPOSITORY,
        username: CONFIG.USERNAME,
        password: CONFIG.PASSWORD,
        branchName,
    });
    await repository.clone();
    await repository.checkout();
    return repository;
};

const throwError = (resolved) => {
    resolved.forEach((process) => {
        if (process.status === 'rejected') {
            console.error('An error has occurred.');
            throw new Error(JSON.stringify(process.reason));
        }
    });
};

const TYPE_PROCESSORS = {
    ubuntu: handleUbuntu,
};

const main = async () => {
    try {
        processConfig();
    } catch (err) {
        console.error('Config processor has failed!', err);
        process.exit(1);
    }
    const processor = await Promise.allSettled([
        TYPE_PROCESSORS[CONFIG.TYPE](),
        // TODO: option for supplying custom branch name and custom prefix
        initializeRepo(`${CONFIG.BRANCH_PREFIX}/${CONFIG.BRANCH_NAME}`),
    ]);
    throwError(processor);
    console.log(`Successfully executed processor ${CONFIG.TYPE}.`);

    const repository = processor[1].value;
    const filePath = `${repository.path}/${CONFIG.FILE}`;
    const keyValuePairs = processor[0].value;

    try {
        const file = new File({ filePath, keyValuePairs });
        await file.run();
    } catch (err) {
        console.error('Updating file has failed!', err);
        process.exit(1);
    }
    console.log(`File "${filePath}" has been successfully updated.`);

    try {
        await repository.push(`update ${CONFIG.TYPE}`);
        await repository.createPullRequest();
    } catch (err) {
        console.error(`Opening pull request with changes has failed!`, err);
        process.exit(1);
    }
    console.log(
        `Successfully pushed branch "${repository.branchName}" to remote.`,
    );
};

main();