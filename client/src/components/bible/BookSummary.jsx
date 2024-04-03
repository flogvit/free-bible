import React, { useState } from 'react';
import styled from 'styled-components';
import DOMPurify from 'dompurify';

const SummaryWrapper = styled.div`
    margin: 20px 0;
`;

const SummaryDetail = styled.div`
    background: lightgrey;
    margin-top: 10px;
    padding: 10px;
    border-left: 4px solid #0077cc;
`;

const SummaryTitle = styled.h1`
    cursor: pointer;
    /* Additional styling for the title */
`;

const BookSummary = React.forwardRef(({ summary, bookName }, ref) => {
    const [showDetail, setShowDetail] = useState(false);

    const toggleDetail = () => {
        setShowDetail(!showDetail);
    };

    // Sanitize the HTML content
    const sanitizedContent = DOMPurify.sanitize(summary.text);

    return (
        <SummaryWrapper ref={ref}>
            <SummaryTitle onClick={toggleDetail}>{bookName}</SummaryTitle>
            {showDetail && (
                <SummaryDetail dangerouslySetInnerHTML={{ __html: sanitizedContent }} />
            )}
        </SummaryWrapper>
    );
});

export default BookSummary;
