import light, {device as lightDevice} from './theme.js';

const color = {
    primary: {
        base: "#111",
        light: "#1e1e1e",
    },
    secondary: {
        xxlight: "#ebf4f3",
    },
    neutral: {
        base: "#333333",
        xlight: "#000",
        xxxlight: "#DDD",
    }
}
export const device = lightDevice;

export default {
    ...JSON.parse(JSON.stringify(light)),
    app: {
        background: color.neutral.xlight
    },
    color,
    header: {
        height: "70px",
        color: {
            background: color.primary.base,
            text: color.neutral.xxxlight
        }
    },
    text: {
        color: {
            main: color.neutral.xxxlight,
            second: color.neutral.xxxlight,
            link: color.primary.base,
        },
    },
    select: {
        colors: {
            neutral0: "black",
            neutral80: "white",
            primary25: color.neutral.base,
            primary: color.neutral.base,
        }
    }
};
