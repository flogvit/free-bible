const color = {
    primary: {
        base: "#9d7d06",
        light: "#b2a46b",
    },
    secondary: {
        xxlight: "#ebf4f3",
    },
    neutral: {
        base: "#333333",
        xlight: "#FFF",
        xxxlight: "#FFF",
    }
};

const font = {
    h1: {
        "font-family": "Staatliches, sans-serif",
        "font-style": "normal",
        "font-weight": "normal",
        "font-size": "24px",
        "line-height": "150%",
        "text-transform": "uppercase",
    },
    h2: {
        "font-family": "Open Sans, sans-serif",
        "font-style": "normal",
        "font-weight": "600",
        "font-size": "20px",
        "line-height": "150%",
    },
    t: {
        "font-family": "Open Sans, sans-serif",
        "font-style": "normal",
        "font-weight": "normal",
        "font-size": "16px",
        "line-height": "150%",
    },
    tb: {
        "font-family": "Open Sans, sans-serif",
        "font-style": "normal",
        "font-weight": "600",
        "font-size": "16px",
        "line-height": "150%",
    },
    s: {
        "font-family": "Open Sans, sans-serif",
        "font-style": "normal",
        "font-weight": "normal",
        "font-size": "14px",
        "line-height": "150%",
    },
};

export const device = {
    mobile: `(min-width: 0px) and (max-width: 767px)`,
    tablet: `(min-width: 768px) and (max-width: 1223px)`,
    desktop: `(min-width: 1224px)`,
    m2t: `(min-width: 0px) and (max-width: 1223px)`,
    t2d: `(min-width: 768px)`,
};

export default {
    breakpoints: {
        m: 0,
        p: 768,
        d: 992,
    },
    spacing: {
        0: "0",
        1: "0.25rem",
        2: "0.5rem",
        3: "1rem",
        4: "1.5rem",
        5: "3rem",
    },
    font: font,
    color: color,
    header: {
        height: "70px",
        color: {
            background: color.primary.base,
            text: color.neutral.xlight
        }
    },
    app: {
        background: color.neutral.xlight
    },
    button: {
        padding_y: "11px",
        padding_x: "20px",
    },
    input: {
        padding: "14px",
    },
    text: {
        color: {
            main: color.neutral.base,
            second: color.neutral.xlight,
            link: color.primary.base,
        },
    },
    select: {colors: {}}
};
