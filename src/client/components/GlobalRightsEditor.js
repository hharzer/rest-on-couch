import React, {PropTypes} from 'react';
import GroupDataEditor from './GroupDataEditor';

import {globalRightTypes} from '../../constants';

const GlobalRightsEditor = ({globalRights, addRight, removeRight}) => (
    <div>
        <div className="content">
            <div className="container-fluid">
                {globalRightTypes.map((right, idx) => {
                    return (
                        <div>
                            <div className="col-md-6" key={right}>
                                <GroupDataEditor
                                    type={right}
                                    data={globalRights[right] || []}
                                    addValue={(value) => addRight(right, value)}
                                    removeValue={(value) => removeRight(right, value)}
                                />
                            </div>
                            {idx % 2 === 1 ? <div className="clearfix" /> : null}
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
);

GlobalRightsEditor.propTypes = {
    globalRights: PropTypes.object.isRequired,
    addRight: PropTypes.func.isRequired,
    removeRight: PropTypes.func.isRequired
};

export default GlobalRightsEditor;